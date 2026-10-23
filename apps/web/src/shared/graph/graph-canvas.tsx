import type { GraphDef } from '@ugula/graph';
import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  Controls,
  type Edge,
  MiniMap,
  ReactFlow
} from '@xyflow/react';
import { useEffect, useMemo, useState } from 'react';
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

export type GraphCanvasProps = Decorations & {
  def: GraphDef;
  catalog: Catalog;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onOpen?: (id: string) => void;
  onChange?: (def: GraphDef) => void;
};

const nodeTypes = { graph: GraphNode };

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
  const [edges, setEdges] = useState<Edge[]>(flow.edges);

  useEffect(() => {
    setNodes(flow.nodes.map((n) => ({ ...n, selected: n.id === selected })));
    setEdges(flow.edges);
  }, [flow, selected]);

  return (
    <div className="h-full min-h-96 w-full">
      <ReactFlow<GraphFlowNode, Edge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        colorMode={theme}
        fitView
        fitViewOptions={{ maxZoom: 1, padding: 0.15 }}
        minZoom={0.15}
        zoomOnDoubleClick={false}
        nodesDraggable={editable}
        nodesConnectable={editable}
        deleteKeyCode={editable ? ['Backspace', 'Delete'] : null}
        onNodesChange={(changes) => setNodes((ns) => applyNodeChanges(changes, ns))}
        onEdgesChange={(changes) => setEdges((es) => applyEdgeChanges(changes, es))}
        onNodeClick={(_, node) => onSelect(node.id)}
        onPaneClick={() => onSelect(null)}
        onNodeDoubleClick={(_, node) => {
          if (node.data.composite) onOpen?.(node.id);
        }}
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
        <MiniMap pannable zoomable />
      </ReactFlow>
    </div>
  );
};
