import {
  ENTRY_TYPE,
  type GraphDef,
  type Edge as GraphEdge,
  isAssignable,
  type NodeInstance,
  type NodeRef,
  type Signature,
  type ValueType
} from '@ugula/graph';
import type { Connection, Edge, Node } from '@xyflow/react';
import type { Catalog } from './catalog.ts';
import { toneOf } from './pins.ts';

export type NodeStatus = 'idle' | 'done' | 'error' | 'waiting';

export type GraphNodeData = {
  instance: NodeInstance;
  title: string;
  signature: Signature | null;
  connected: string[];
  status: NodeStatus;
  issues: string[];
  composite: boolean;
};

export type GraphFlowNode = Node<GraphNodeData, 'graph'>;

export type Decorations = {
  status?: Readonly<Record<string, NodeStatus>>;
  issues?: Readonly<Record<string, readonly string[]>>;
};

type PinEnd = { exec: boolean; type: ValueType | null };

export const edgeId = (e: GraphEdge) => `${e.from}:${e.fromPin}->${e.to}:${e.toPin}`;

const GRID = { x: 320, y: 200 };

export const layout = (def: GraphDef): Record<string, { x: number; y: number }> => {
  const depth = new Map(def.nodes.map((n) => [n.id, 0]));
  for (let pass = 0; pass < def.nodes.length; pass++) {
    let moved = false;
    for (const e of def.edges) {
      const next = (depth.get(e.from) ?? 0) + 1;
      if (e.from !== e.to && next > (depth.get(e.to) ?? 0) && next < def.nodes.length) {
        depth.set(e.to, next);
        moved = true;
      }
    }
    if (!moved) break;
  }
  const rows = new Map<number, number>();
  return Object.fromEntries(
    def.nodes.map((n) => {
      const column = depth.get(n.id) ?? 0;
      const row = rows.get(column) ?? 0;
      rows.set(column, row + 1);
      return [n.id, { x: column * GRID.x, y: row * GRID.y }];
    })
  );
};

const outputOf = (sig: Signature | null, pin: string): PinEnd | null => {
  if (!sig) return null;
  if (sig.execOut.includes(pin)) return { exec: true, type: null };
  const spec = sig.outputs.find((p) => p.name === pin);
  return spec ? { exec: false, type: spec.type } : null;
};

const inputOf = (sig: Signature | null, pin: string): PinEnd | null => {
  if (!sig) return null;
  if (sig.execIn.includes(pin)) return { exec: true, type: null };
  const spec = sig.inputs.find((p) => p.name === pin);
  return spec ? { exec: false, type: spec.type } : null;
};

const signatureById = (def: GraphDef, catalog: Catalog, id: string) => {
  const inst = def.nodes.find((n) => n.id === id);
  return inst ? catalog.signatureOf(inst, def) : null;
};

export const toFlow = (
  def: GraphDef,
  catalog: Catalog,
  { status = {}, issues = {} }: Decorations = {}
) => {
  const placed = def.nodes.every((n) => n.position) ? {} : layout(def);
  const nodes: GraphFlowNode[] = def.nodes.map((inst) => {
    const signature = catalog.signatureOf(inst, def);
    return {
      id: inst.id,
      type: 'graph',
      position: inst.position ?? placed[inst.id] ?? { x: 0, y: 0 },
      deletable: inst.type !== ENTRY_TYPE,
      data: {
        instance: inst,
        title: catalog.titleOf(inst),
        signature,
        connected: def.edges.filter((e) => e.to === inst.id).map((e) => e.toPin),
        status: status[inst.id] ?? 'idle',
        issues: [...(issues[inst.id] ?? [])],
        composite: catalog.graphOf(inst) !== undefined && !inst.type.startsWith('std.graph.')
      }
    };
  });
  const edges: Edge[] = def.edges.map((e) => {
    const end = outputOf(signatureById(def, catalog, e.from), e.fromPin);
    return {
      id: edgeId(e),
      source: e.from,
      sourceHandle: e.fromPin,
      target: e.to,
      targetHandle: e.toPin,
      className: toneOf(end?.exec ? 'exec' : (end?.type ?? 'any')).edge,
      animated: status[e.to] === 'waiting'
    };
  });
  return { nodes, edges };
};

export const connectionKind = (def: GraphDef, catalog: Catalog, c: Connection) => {
  if (!c.sourceHandle || !c.targetHandle || c.source === c.target) return null;
  const from = outputOf(signatureById(def, catalog, c.source), c.sourceHandle);
  const to = inputOf(signatureById(def, catalog, c.target), c.targetHandle);
  if (!from || !to || from.exec !== to.exec) return null;
  if (from.exec) return 'exec';
  return from.type && to.type && isAssignable(from.type, to.type) ? 'data' : null;
};

export const connect = (def: GraphDef, catalog: Catalog, c: Connection): GraphDef => {
  const kind = connectionKind(def, catalog, c);
  if (!kind || !c.sourceHandle || !c.targetHandle) return def;
  const edge = { from: c.source, fromPin: c.sourceHandle, to: c.target, toPin: c.targetHandle };
  const kept = def.edges.filter((e) =>
    kind === 'exec'
      ? !(e.from === edge.from && e.fromPin === edge.fromPin)
      : !(e.to === edge.to && e.toPin === edge.toPin)
  );
  const nodes =
    kind === 'data'
      ? def.nodes.map((n) => {
          if (n.id !== edge.to || !n.inputs?.[edge.toPin]) return n;
          const { [edge.toPin]: _, ...inputs } = n.inputs;
          return { ...n, inputs };
        })
      : def.nodes;
  return { ...def, nodes, edges: [...kept, edge] };
};

const nextId = (def: GraphDef, type: string) => {
  const base = (type.split('.').at(-1) ?? 'node').replace(/[^a-z0-9]/gi, '') || 'node';
  const taken = new Set(def.nodes.map((n) => n.id));
  for (let i = 1; ; i++) if (!taken.has(`${base}${i}`)) return `${base}${i}`;
};

export const addNode = (def: GraphDef, ref: NodeRef, position: { x: number; y: number }) => {
  const id = nextId(def, ref.type);
  return {
    id,
    def: { ...def, nodes: [...def.nodes, { id, type: ref.type, version: ref.version, position }] }
  };
};

export const removeNodes = (def: GraphDef, ids: readonly string[]): GraphDef => {
  const drop = new Set(
    def.nodes.filter((n) => ids.includes(n.id) && n.type !== ENTRY_TYPE).map((n) => n.id)
  );
  return {
    ...def,
    nodes: def.nodes.filter((n) => !drop.has(n.id)),
    edges: def.edges.filter((e) => !drop.has(e.from) && !drop.has(e.to))
  };
};

export const removeEdges = (def: GraphDef, ids: readonly string[]): GraphDef => ({
  ...def,
  edges: def.edges.filter((e) => !ids.includes(edgeId(e)))
});

export const moveNodes = (
  def: GraphDef,
  positions: Readonly<Record<string, { x: number; y: number }>>
): GraphDef => ({
  ...def,
  nodes: def.nodes.map((n) => {
    const p = positions[n.id];
    return p ? { ...n, position: { x: Math.round(p.x), y: Math.round(p.y) } } : n;
  })
});

export const updateNode = (def: GraphDef, id: string, next: NodeInstance): GraphDef => ({
  ...def,
  nodes: def.nodes.map((n) => (n.id === id ? next : n))
});

export const withSignature = (
  def: GraphDef,
  patch: Partial<Pick<GraphDef, 'signature' | 'variables'>>
): GraphDef => ({ ...def, ...patch, nodes: def.nodes.map((n) => ({ ...n })) });
