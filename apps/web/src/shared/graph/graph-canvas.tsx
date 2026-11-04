import type { GraphDef } from '@ugula/graph';
import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  Controls,
  type Edge,
  ReactFlow
} from '@xyflow/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useDocumentTheme } from '../ui/theme-toggle.tsx';
import type { Catalog } from './catalog.ts';
import {
  connect,
  connectionKind,
  type Decorations,
  type GraphFlowNode,
  moveNodes,
  removeEdges,
  removeNodes,
  toFlow
} from './flow.ts';
import { GraphNode } from './graph-node.tsx';

type GraphCanvasProps = Decorations & {
  def: GraphDef;
  catalog: Catalog;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onOpen?: (id: string) => void;
  onChange?: (def: GraphDef) => void;
};

const nodeTypes = { graph: GraphNode };

export const OPENING_WIDTH = 1800;

const DOUBLE_CLICK_MS = 300;

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

export const GraphCanvas = ({
  def,
  catalog,
  status,
  issues,
  selected,
  onSelect,
  onOpen,
  onChange
}: GraphCanvasProps) => {
  const theme = useDocumentTheme();
  const editable = onChange !== undefined;
  const flow = useMemo(
    () => toFlow(def, catalog, { ...(status ? { status } : {}), ...(issues ? { issues } : {}) }),
    [def, catalog, status, issues]
  );
  const [nodes, setNodes] = useState<GraphFlowNode[]>(flow.nodes);
  const [opening] = useState(() => openingNodes(flow.nodes));
  const [edges, setEdges] = useState<Edge[]>(flow.edges);

  const selectedRef = useRef(selected);
  const handlers = useRef({ onSelect, onOpen });
  handlers.current = { onSelect, onOpen };
  const [clicks] = useState(() =>
    nodeClicks({
      onSelect: (id) => handlers.current.onSelect(id),
      onOpen: (id) => handlers.current.onOpen?.(id)
    })
  );
  useEffect(() => clicks.cancel, [clicks]);
  selectedRef.current = selected;

  useEffect(() => {
    setNodes((prev) => {
      const before = new Map(prev.map((n) => [n.id, n]));
      return flow.nodes.map((n) => {
        const measured = before.get(n.id)?.measured;
        return { ...n, selected: n.id === selectedRef.current, ...(measured ? { measured } : {}) };
      });
    });
    setEdges(flow.edges);
  }, [flow]);

  useEffect(() => {
    setNodes((ns) =>
      ns.map((n) =>
        n.selected === (n.id === selected) ? n : { ...n, selected: n.id === selected }
      )
    );
  }, [selected]);

  return (
    <div className="h-full min-h-96 w-full">
      <ReactFlow<GraphFlowNode, Edge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        colorMode={theme}
        className="[--xy-background-color:var(--color-canvas)] [--xy-background-pattern-color:var(--color-border)] [--xy-edge-stroke-width:2]"
        fitView
        fitViewOptions={{ maxZoom: 1, padding: 0.15, nodes: opening }}
        minZoom={0.15}
        zoomOnDoubleClick={false}
        nodesDraggable={editable}
        nodesConnectable={editable}
        deleteKeyCode={editable ? ['Backspace', 'Delete'] : null}
        onNodesChange={(changes) => setNodes((ns) => applyNodeChanges(changes, ns))}
        onEdgesChange={(changes) => setEdges((es) => applyEdgeChanges(changes, es))}
        onNodeClick={(_, node) =>
          clicks.click(node.id, node.data.opens !== null && onOpen !== undefined)
        }
        onPaneClick={() => onSelect(null)}
        onNodeDoubleClick={(_, node) => clicks.doubleClick(node.id, node.data.opens !== null)}
        onNodeDragStop={(_, __, dragged) =>
          onChange?.(moveNodes(def, Object.fromEntries(dragged.map((n) => [n.id, n.position]))))
        }
        onNodesDelete={(deleted) =>
          onChange?.(
            removeNodes(
              def,
              deleted.map((n) => n.id)
            )
          )
        }
        onEdgesDelete={(deleted) =>
          onChange?.(
            removeEdges(
              def,
              deleted.map((e) => e.id)
            )
          )
        }
        onConnect={(c) => onChange?.(connect(def, catalog, c))}
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
      </ReactFlow>
    </div>
  );
};
