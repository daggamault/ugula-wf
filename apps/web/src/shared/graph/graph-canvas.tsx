import type { GraphDef } from '@ugula/graph';
import {
  Background,
  Controls,
  type Edge,
  MiniMap,
  type NodeChangeset,
  Panel,
  ReactFlow,
  type ReactFlowInstance
} from '@xyflow/react';
import { MessageSquarePlusIcon } from 'lucide-react';
import {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type Ref,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState
} from 'react';
import { Button } from '../ui/button.tsx';
import type { Catalog } from './catalog.ts';
import { clipFrom, clipOf, clipText, pasted } from './clipboard.ts';
import { CommentActions, CommentNode } from './comment-node.tsx';
import {
  addComment,
  boundsOf,
  type CommentFlowNode,
  commentIdOf,
  commentNodeId,
  commentsToFlow,
  framed,
  moveComments,
  type Rect,
  removeComments,
  updateComment
} from './comments.ts';
import {
  connect,
  connectionKind,
  type Decorations,
  disconnectPin,
  type GraphFlowNode,
  insertReroute,
  moveNodes,
  type PinRef,
  removeEdges,
  removeNodes,
  revealPin,
  toFlow
} from './flow.ts';
import { GraphNode, NodeActions } from './graph-node.tsx';
import { NODE_WIDTH } from './layout.ts';

type Point = { x: number; y: number };

export type AddRequest = { at: Point; screen: Point; from: PinRef | null };

export type CanvasView = { centre: () => AddRequest | null };

type CanvasNode = GraphFlowNode | CommentFlowNode;

type GraphCanvasProps = Decorations & {
  def: GraphDef;
  catalog: Catalog;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onOpen?: (id: string) => void;
  onChange?: (def: GraphDef) => void;
  onAdd?: (request: AddRequest) => void;
  tools?: ReactNode;
  viewRef?: Ref<CanvasView>;
};

const nodeTypes = { graph: GraphNode, comment: CommentNode };

export const OPENING_WIDTH = 1800;

const DOUBLE_CLICK_MS = 300;

const FALLBACK_HEIGHT = 96;

type Timer = ReturnType<typeof setTimeout>;

export const nodeClicks = ({
  onSelect,
  onOpen,
  delayMs = DOUBLE_CLICK_MS
}: {
  onSelect: (id: string) => void;
  onOpen?: ((id: string) => void) | undefined;
  delayMs?: number;
}) => {
  let pending: Timer | undefined;
  const cancel = () => clearTimeout(pending);
  return {
    click: (id: string, opens: boolean) => {
      cancel();
      if (opens && onOpen) pending = setTimeout(() => onSelect(id), delayMs);
      else onSelect(id);
    },
    doubleClick: (id: string, opens: boolean) => {
      cancel();
      if (opens) onOpen?.(id);
    },
    cancel
  };
};

export const openingNodes = (nodes: readonly { id: string; position: { x: number } }[]) => {
  const left = Math.min(...nodes.map((n) => n.position.x));
  return nodes.filter((n) => n.position.x <= left + OPENING_WIDTH).map((n) => ({ id: n.id }));
};

export const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

const isControl = (target: EventTarget | null) =>
  isTyping(target) || (target instanceof HTMLElement && ['BUTTON', 'A'].includes(target.tagName));

const rectOf = (n: CanvasNode): Rect & { id: string } => ({
  id: n.id,
  x: n.position.x,
  y: n.position.y,
  width: n.measured?.width ?? n.width ?? NODE_WIDTH,
  height: n.measured?.height ?? n.height ?? FALLBACK_HEIGHT
});

const isGraphNode = (n: CanvasNode): n is GraphFlowNode => n.type === 'graph';

export const selectionOf = (nodes: readonly CanvasNode[]) => {
  const picked = nodes.filter((n) => n.selected);
  return {
    nodes: picked.filter((n) => isGraphNode(n) && !n.data.ghost).map((n) => n.id),
    comments: picked.flatMap((n) => commentIdOf(n.id) ?? [])
  };
};

const pointOf = (e: MouseEvent | TouchEvent | ReactMouseEvent) => {
  const p = 'changedTouches' in e ? e.changedTouches[0] : e;
  return { x: p?.clientX ?? 0, y: p?.clientY ?? 0 };
};

type Carry = { anchor: Point; items: Map<string, Point> };

export const GraphCanvas = ({
  def,
  catalog,
  status,
  issues,
  changes,
  changedEdges,
  removed,
  selected,
  onSelect,
  onOpen,
  onChange,
  onAdd,
  tools,
  viewRef
}: GraphCanvasProps) => {
  const editable = onChange !== undefined;
  const flow = useMemo(
    () =>
      toFlow(def, catalog, {
        ...(status ? { status } : {}),
        ...(issues ? { issues } : {}),
        ...(changes ? { changes } : {}),
        ...(changedEdges ? { changedEdges } : {}),
        ...(removed ? { removed } : {})
      }),
    [def, catalog, status, issues, changes, changedEdges, removed]
  );
  const comments = useMemo(() => commentsToFlow(def), [def]);
  const [nodes, setNodes] = useState<CanvasNode[]>(() => [...comments, ...flow.nodes]);
  const [opening] = useState(() => openingNodes(flow.nodes));
  const [edges, setEdges] = useState<Edge[]>(flow.edges);
  const box = useRef<HTMLDivElement>(null);
  const instance = useRef<ReactFlowInstance<CanvasNode, Edge> | null>(null);
  const carry = useRef<Carry | null>(null);
  const pendingSelection = useRef<Set<string> | null>(null);

  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const handlers = useRef({ onSelect, onOpen });
  handlers.current = { onSelect, onOpen };
  const latest = useRef({ def, nodes, onChange, onAdd });
  latest.current = { def, nodes, onChange, onAdd };
  const [clicks] = useState(() =>
    nodeClicks({
      onSelect: (id) => handlers.current.onSelect(id),
      onOpen: (id) => handlers.current.onOpen?.(id)
    })
  );
  useEffect(() => clicks.cancel, [clicks]);
  const nodesChange = (changes: NodeChangeset<CanvasNode>) => {
    setNodes((ns) => changes.applyTo(ns));
    const current = selectedRef.current;
    if (current === null) return;
    if (changes.getByType('select').some((c) => c.selected !== (c.id === current))) {
      handlers.current.onSelect(null);
    }
  };
  const reconnected = useRef(true);

  const requestAt = (screen: Point, from: PinRef | null): AddRequest | null => {
    const rf = instance.current;
    return rf ? { at: rf.screenToFlowPosition(screen), screen, from } : null;
  };

  const centre = () => {
    const rect = box.current?.getBoundingClientRect();
    return rect
      ? requestAt({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }, null)
      : null;
  };

  useImperativeHandle(viewRef, () => ({ centre }));

  useEffect(() => {
    setNodes((prev) => {
      const before = new Map(prev.map((n) => [n.id, n]));
      const pending = pendingSelection.current;
      pendingSelection.current = null;
      return [...comments, ...flow.nodes].map((n) => {
        const old = before.get(n.id);
        const isSelected = pending
          ? pending.has(n.id)
          : (old?.selected ?? n.id === selectedRef.current);
        return {
          ...n,
          selected: isSelected,
          ...(old?.measured ? { measured: old.measured } : {})
        } as CanvasNode;
      });
    });
    setEdges(flow.edges);
  }, [flow, comments]);

  useEffect(() => {
    if (selected === null) return;
    setNodes((ns) =>
      ns.map((n) =>
        n.selected === (n.id === selected) ? n : { ...n, selected: n.id === selected }
      )
    );
  }, [selected]);

  const commit = (next: GraphDef, select?: Set<string>) => {
    if (select) pendingSelection.current = select;
    latest.current.onChange?.(next);
  };

  const pasteInto = (text: string) => {
    const { def: current } = latest.current;
    const clip = clipFrom(text, current);
    if (!clip || (!clip.nodes.length && !clip.comments.length)) return false;
    const out = pasted(current, clip);
    handlers.current.onSelect(null);
    commit(out.def, new Set([...out.nodes, ...out.comments.map(commentNodeId)]));
    return true;
  };

  const commentAround = () => {
    const { def: current, nodes: ns } = latest.current;
    const picked = selectionOf(ns);
    const rects = ns.filter((n) => picked.nodes.includes(n.id)).map(rectOf);
    const at = centre()?.at ?? { x: 0, y: 0 };
    const added = addComment(current, boundsOf(rects), at);
    commit(added.def, new Set([commentNodeId(added.id)]));
  };

  const keys = useRef({ pasteInto, commentAround });
  keys.current = { pasteInto, commentAround };

  useEffect(() => {
    if (!editable) return;
    const hasTextSelection = () => window.getSelection()?.isCollapsed === false;
    const onCopy = (e: ClipboardEvent) => {
      if (isTyping(e.target) || hasTextSelection()) return;
      const { def: current, nodes: ns } = latest.current;
      const picked = selectionOf(ns);
      if (!picked.nodes.length && !picked.comments.length) return;
      e.clipboardData?.setData(
        'text/plain',
        clipText(clipOf(current, picked.nodes, picked.comments))
      );
      e.preventDefault();
    };
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(e.target)) return;
      if (keys.current.pasteInto(e.clipboardData?.getData('text/plain') ?? '')) e.preventDefault();
    };
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.altKey) return;
      const mod = e.ctrlKey || e.metaKey;
      const inCanvas = e.target instanceof Node && box.current?.contains(e.target) === true;
      if (e.key.toLowerCase() === 'a' && !e.shiftKey && !mod && inCanvas && !isControl(e.target)) {
        const request = centre();
        if (!request || !latest.current.onAdd) return;
        e.preventDefault();
        latest.current.onAdd(request);
        return;
      }
      const { def: current, nodes: ns } = latest.current;
      const picked = selectionOf(ns);
      if (mod && e.key.toLowerCase() === 'd' && picked.nodes.length + picked.comments.length) {
        e.preventDefault();
        keys.current.pasteInto(clipText(clipOf(current, picked.nodes, picked.comments)));
      } else if (!mod && !e.shiftKey && e.key.toLowerCase() === 'c' && picked.nodes.length) {
        e.preventDefault();
        keys.current.commentAround();
      }
    };
    document.addEventListener('copy', onCopy);
    document.addEventListener('paste', onPaste);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('paste', onPaste);
      window.removeEventListener('keydown', onKey);
    };
  }, [editable]);

  const update = (id: string, patch: Parameters<typeof updateComment>[2]) =>
    onChange?.(updateComment(def, id, patch));

  return (
    <div ref={box} className="h-full min-h-96 w-full">
      <NodeActions
        value={
          onChange
            ? {
                breakPin: (node, pin, side) => onChange(disconnectPin(def, node, pin, side)),
                revealPin: (node, pin) => onChange(revealPin(def, node, pin))
              }
            : null
        }
      >
        <CommentActions value={onChange ? update : null}>
          <ReactFlow<CanvasNode, Edge>
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            className="[&_.react-flow__node:focus-visible]:outline-primary [--xy-background-color:var(--color-canvas)] [--xy-background-pattern-color:var(--color-border)] [--xy-edge-stroke-width:2] [&_.react-flow__node:focus-visible]:rounded-xl [&_.react-flow__node:focus-visible]:outline-2 [&_.react-flow__node:focus-visible]:outline-offset-2"
            onInit={(rf) => {
              instance.current = rf;
            }}
            fitView
            fitViewOptions={{ maxZoom: 1, padding: '15%', nodes: opening }}
            minZoom={0.15}
            zoomOnDoubleClick={false}
            nodesDraggable={editable}
            nodesConnectable={editable}
            deleteKeyCode={editable ? ['Backspace', 'Delete'] : null}
            onNodesChange={nodesChange}
            onEdgesChange={(c) => setEdges((es) => c.applyTo(es))}
            onNodeClick={(e, node) => {
              if (!isGraphNode(node) || node.data.ghost || e.ctrlKey || e.metaKey || e.shiftKey)
                return;
              clicks.click(node.id, node.data.opens !== null && onOpen !== undefined);
            }}
            onPaneClick={() => onSelect(null)}
            onPaneContextMenu={(e) => {
              if (!onAdd) return;
              e.preventDefault();
              const request = requestAt(pointOf(e), null);
              if (request) onAdd(request);
            }}
            onNodeDoubleClick={(_, node) =>
              isGraphNode(node) && clicks.doubleClick(node.id, node.data.opens !== null)
            }
            onNodeDragStart={(_, node, dragged) => {
              const moving = new Set(dragged.map((n) => n.id));
              const frames = dragged.filter((n) => n.type === 'comment').map(rectOf);
              const inside = frames.flatMap((f) =>
                framed(f, nodes.filter((n) => isGraphNode(n) && !moving.has(n.id)).map(rectOf))
              );
              carry.current = inside.length
                ? {
                    anchor: node.position,
                    items: new Map(
                      nodes.filter((n) => inside.includes(n.id)).map((n) => [n.id, n.position])
                    )
                  }
                : null;
            }}
            onNodeDrag={(_, node) => {
              const c = carry.current;
              if (!c) return;
              const dx = node.position.x - c.anchor.x;
              const dy = node.position.y - c.anchor.y;
              setNodes((ns) =>
                ns.map((n) => {
                  const p = c.items.get(n.id);
                  return p ? { ...n, position: { x: p.x + dx, y: p.y + dy } } : n;
                })
              );
            }}
            onNodeDragStop={(_, node, dragged) => {
              const c = carry.current;
              carry.current = null;
              const dx = c ? node.position.x - c.anchor.x : 0;
              const dy = c ? node.position.y - c.anchor.y : 0;
              const carried = c
                ? [...c.items].map(([id, p]) => [id, { x: p.x + dx, y: p.y + dy }] as const)
                : [];
              const moved = [...dragged.map((n) => [n.id, n.position] as const), ...carried];
              const nodeMoves = Object.fromEntries(moved.filter(([id]) => !commentIdOf(id)));
              const commentMoves = Object.fromEntries(
                moved.flatMap(([id, p]) => {
                  const cid = commentIdOf(id);
                  return cid ? [[cid, p]] : [];
                })
              );
              onChange?.(moveComments(moveNodes(def, nodeMoves), commentMoves));
            }}
            onDelete={({ nodes: gone, edges: cut }) => {
              const ids = gone.map((n) => n.id);
              onChange?.(
                removeEdges(
                  removeComments(
                    removeNodes(def, ids),
                    ids.flatMap((id) => commentIdOf(id) ?? [])
                  ),
                  cut.map((e) => e.id)
                )
              );
            }}
            onEdgeClick={(e, edge) => {
              if (e.altKey) onChange?.(removeEdges(def, [edge.id]));
            }}
            onEdgeDoubleClick={(e, edge) => {
              const at = requestAt(pointOf(e), null)?.at;
              const knot = at && onChange ? insertReroute(def, catalog, edge.id, at) : null;
              if (knot) onChange?.(knot.def);
            }}
            onConnect={(c) => onChange?.(connect(def, catalog, c))}
            onConnectEnd={(e, state) => {
              const handle = state.fromHandle;
              if (!onAdd || !handle?.id || state.toHandle) return;
              const request = requestAt(pointOf(e), {
                node: handle.nodeId,
                pin: handle.id,
                side: handle.type === 'source' ? 'out' : 'in'
              });
              if (request) onAdd(request);
            }}
            edgesReconnectable={editable}
            onReconnectStart={() => {
              reconnected.current = false;
            }}
            onReconnect={(old, c) => {
              reconnected.current = true;
              onChange?.(connect(removeEdges(def, [old.id]), catalog, c));
            }}
            onReconnectEnd={(_, old) => {
              if (!reconnected.current) onChange?.(removeEdges(def, [old.id]));
              reconnected.current = true;
            }}
            isValidConnection={(c) =>
              connectionKind(def, catalog, {
                source: c.source,
                target: c.target,
                sourceHandle: c.sourceHandle ?? null,
                targetHandle: c.targetHandle ?? null
              }) !== null
            }
          >
            <Background gap={24} />
            <Controls showInteractive={false} />
            <MiniMap<CanvasNode>
              pannable
              zoomable
              ariaLabel="Mini Map"
              className="border-border overflow-hidden rounded-xl border max-sm:hidden"
              bgColor="var(--color-surface)"
              maskColor="color-mix(in oklab, var(--color-canvas) 70%, transparent)"
              nodeColor={(n) =>
                isGraphNode(n) ? `var(--color-node-${n.data.kind})` : 'transparent'
              }
              nodeStrokeColor={(n) => (isGraphNode(n) ? 'transparent' : 'var(--color-border)')}
            />
            {tools || editable ? (
              <Panel position="top-left" className="flex flex-wrap items-center gap-2">
                {tools}
                {editable ? (
                  <Button variant="outline" onClick={() => keys.current.commentAround()}>
                    <MessageSquarePlusIcon aria-hidden="true" className="size-4" />
                    Add Comment
                  </Button>
                ) : null}
              </Panel>
            ) : null}
          </ReactFlow>
        </CommentActions>
      </NodeActions>
    </div>
  );
};
