import {
  ENTRY_TYPE,
  type ExitDoc,
  type GraphDef,
  type Edge as GraphEdge,
  isAssignable,
  type Json,
  type NodeInstance,
  type NodeRef,
  type Signature,
  type ValueType
} from '@ugula/graph';
import type { Connection, Edge, Node } from '@xyflow/react';
import type { Catalog, NodeKind, Opens, PaletteEntry } from './catalog.ts';
import { layout, NODE_WIDTH, shapeOf } from './layout.ts';
import { toneOf } from './pins.ts';

export type NodeStatus = 'idle' | 'done' | 'error' | 'waiting';

export type NodeChange = 'added' | 'changed' | 'overridden';

type PinSide = 'in' | 'out';

export type PinRef = { node: string; pin: string; side: PinSide };

type Point = { x: number; y: number };

type Fold = { side: PinSide; shown: string[] };

export type GraphNodeData = {
  instance: NodeInstance;
  title: string;
  description: string;
  summary: string | null;
  kind: NodeKind;
  signature: Signature | null;
  exits: Readonly<Record<string, ExitDoc>>;
  fold: Fold | null;
  connected: string[];
  status: NodeStatus;
  issues: string[];
  opens: Opens | null;
  change: NodeChange | null;
  ghost: boolean;
};

export type GraphFlowNode = Node<GraphNodeData, 'graph'>;

export type Decorations = {
  status?: Readonly<Record<string, NodeStatus>>;
  issues?: Readonly<Record<string, readonly string[]>>;
  changes?: Readonly<Record<string, NodeChange>>;
  changedEdges?: ReadonlySet<string>;
  removed?: readonly NodeInstance[];
};

const GHOST_PREFIX = 'removed:';

const CUSTOM_EDGE = '[&_.react-flow__edge-path]:stroke-custom';

type PinEnd = { exec: boolean; type: ValueType | null };

export const edgeId = (e: GraphEdge) => `${e.from}:${e.fromPin}->${e.to}:${e.toPin}`;

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

const arrange = (def: GraphDef, catalog: Catalog) =>
  layout(
    def,
    new Map(
      def.nodes.map((n) => [n.id, shapeOf(catalog.signatureOf(n, def), catalog.describe(n) !== '')])
    )
  );

export const foldedSide = (type: string): PinSide | null =>
  type.startsWith('std.list.')
    ? null
    : type.endsWith('.break')
      ? 'out'
      : type.endsWith('.make')
        ? 'in'
        : null;

const foldOf = (inst: NodeInstance, def: GraphDef, sig: Signature | null): Fold | null => {
  const side = foldedSide(inst.type);
  if (!side || !sig) return null;
  const wired =
    side === 'in'
      ? def.edges.filter((e) => e.to === inst.id).map((e) => e.toPin)
      : def.edges.filter((e) => e.from === inst.id).map((e) => e.fromPin);
  const required = side === 'in' ? sig.inputs.filter((p) => !p.optional).map((p) => p.name) : [];
  const bound = side === 'in' ? Object.keys(inst.inputs ?? {}) : [];
  const shown = new Set([...wired, ...required, ...bound, ...(inst.shown ?? [])]);
  return {
    side,
    shown: (side === 'in' ? sig.inputs : sig.outputs).map((p) => p.name).filter((n) => shown.has(n))
  };
};

const nodeData = (
  inst: NodeInstance,
  def: GraphDef,
  catalog: Catalog,
  extra: Pick<GraphNodeData, 'status' | 'issues' | 'change' | 'ghost'>
): GraphNodeData => {
  const signature = catalog.signatureOf(inst, def);
  return {
    instance: inst,
    title: catalog.titleOf(inst),
    description: catalog.describe(inst),
    summary: catalog.summaryOf(inst),
    kind: catalog.kindOf(inst, signature),
    signature,
    exits: catalog.exitsOf(inst, def),
    fold: foldOf(inst, def, signature),
    connected: def.edges.filter((e) => e.to === inst.id).map((e) => e.toPin),
    opens: extra.ghost ? null : catalog.opensAs(inst),
    ...extra
  };
};

export const toFlow = (
  def: GraphDef,
  catalog: Catalog,
  { status = {}, issues = {}, changes = {}, changedEdges, removed = [] }: Decorations = {}
) => {
  const placed = def.nodes.every((n) => n.position) ? {} : arrange(def, catalog);
  const nodes: GraphFlowNode[] = def.nodes.map((inst) => ({
    id: inst.id,
    type: 'graph',
    position: inst.position ?? placed[inst.id] ?? { x: 0, y: 0 },
    deletable: inst.type !== ENTRY_TYPE,
    data: nodeData(inst, def, catalog, {
      status: status[inst.id] ?? 'idle',
      issues: [...(issues[inst.id] ?? [])],
      change: changes[inst.id] ?? null,
      ghost: false
    })
  }));
  const ghosts: GraphFlowNode[] = removed.map((inst) => ({
    id: `${GHOST_PREFIX}${inst.id}`,
    type: 'graph',
    position: inst.position ?? { x: 0, y: 0 },
    deletable: false,
    draggable: false,
    selectable: false,
    connectable: false,
    zIndex: -1,
    data: nodeData(inst, def, catalog, { status: 'idle', issues: [], change: null, ghost: true })
  }));
  const edges: Edge[] = def.edges.map((e) => {
    const end = outputOf(signatureById(def, catalog, e.from), e.fromPin);
    return {
      id: edgeId(e),
      source: e.from,
      sourceHandle: e.fromPin,
      target: e.to,
      targetHandle: e.toPin,
      className: changedEdges?.has(edgeId(e))
        ? CUSTOM_EDGE
        : toneOf(end?.exec ? 'exec' : (end?.type ?? 'any')).edge,
      animated: status[e.to] === 'waiting'
    };
  });
  return { nodes: [...ghosts, ...nodes], edges };
};

export const connectionKind = (def: GraphDef, catalog: Catalog, c: Connection) => {
  if (!c.sourceHandle || !c.targetHandle || c.source === c.target) return null;
  const from = outputOf(signatureById(def, catalog, c.source), c.sourceHandle);
  const to = inputOf(signatureById(def, catalog, c.target), c.targetHandle);
  if (!from || !to || from.exec !== to.exec) return null;
  if (from.exec) return 'exec';
  return from.type && to.type && isAssignable(from.type, to.type) ? 'data' : null;
};

type Adoption = { pins: RegExp; key: string; from: (type: ValueType) => ValueType | null };

const itemOf = (type: ValueType) => (typeof type === 'object' && 'list' in type ? type.list : null);

const recordOf = (type: ValueType) => (typeof type === 'object' && 'object' in type ? type : null);

const ADOPTIONS: Readonly<Record<string, Adoption>> = {
  'std.object.get-field': { pins: /^record$/, key: 'record', from: recordOf },
  'std.object.set-field': { pins: /^record$/, key: 'record', from: recordOf },
  'std.list.make': { pins: /^item\d+$/, key: 'type', from: (t) => t },
  'std.list.join': { pins: /^list\d+$/, key: 'type', from: itemOf },
  'std.logic.choose': { pins: /^(option\d+|case\d+|otherwise)$/, key: 'type', from: (t) => t },
  'std.flow.reroute': { pins: /^value$/, key: 'type', from: (t) => t }
};

const adopt = (inst: NodeInstance, pin: string, type: ValueType | undefined): NodeInstance => {
  const rule = Object.hasOwn(ADOPTIONS, inst.type) ? ADOPTIONS[inst.type] : undefined;
  if (!rule || !type || type === 'any' || !rule.pins.test(pin)) return inst;
  const config = (inst.config ?? {}) as Record<string, Json>;
  const current = config[rule.key];
  const adopted = rule.from(type);
  return adopted && (current === undefined || current === 'any')
    ? { ...inst, config: { ...config, [rule.key]: adopted as Json } }
    : inst;
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
  const from = outputOf(signatureById(def, catalog, edge.from), edge.fromPin);
  const nodes =
    kind === 'data'
      ? def.nodes.map((n) => {
          if (n.id !== edge.to) return n;
          const typed = adopt(n, edge.toPin, from?.type ?? undefined);
          if (!typed.inputs?.[edge.toPin]) return typed;
          const { [edge.toPin]: _, ...inputs } = typed.inputs;
          return { ...typed, inputs };
        })
      : def.nodes;
  return { ...def, nodes, edges: [...kept, edge] };
};

const nextId = (def: GraphDef, type: string) => {
  const base = (type.split('.').at(-1) ?? 'node').replace(/[^a-z0-9]/gi, '') || 'node';
  const taken = new Set(def.nodes.map((n) => n.id));
  for (let i = 1; ; i++) if (!taken.has(`${base}${i}`)) return `${base}${i}`;
};

export const addNode = (def: GraphDef, ref: NodeRef, position: Point, config?: Json) => {
  const id = nextId(def, ref.type);
  const inst: NodeInstance = {
    id,
    type: ref.type,
    version: ref.version,
    position,
    ...(config === undefined ? {} : { config })
  };
  return { id, def: { ...def, nodes: [...def.nodes, inst] } };
};

const PROBE = '__probe';

const endOf = (def: GraphDef, catalog: Catalog, { node, pin, side }: PinRef) =>
  (side === 'out' ? outputOf : inputOf)(signatureById(def, catalog, node), pin);

const wiringPin = (def: GraphDef, catalog: Catalog, ref: NodeRef, from: PinRef) => {
  const end = endOf(def, catalog, from);
  const sig = end && catalog.signatureOf({ id: PROBE, type: ref.type, version: ref.version }, def);
  if (!end || !sig) return null;
  if (end.exec) return (from.side === 'out' ? sig.execIn[0] : sig.execOut[0]) ?? null;
  const type = end.type ?? 'any';
  const fits = (from.side === 'out' ? sig.inputs : sig.outputs).filter((p) =>
    from.side === 'out' ? isAssignable(type, p.type) : isAssignable(p.type, type)
  );
  return (fits.find((p) => p.type !== 'any') ?? fits[0])?.name ?? null;
};

export const compatibleEntries = (def: GraphDef, catalog: Catalog, from: PinRef): PaletteEntry[] =>
  catalog.palette.filter((e) => wiringPin(def, catalog, e, from) !== null);

export const addWired = (
  def: GraphDef,
  catalog: Catalog,
  ref: NodeRef,
  at: Point,
  from: PinRef | null
) => {
  const added = addNode(def, ref, {
    x: Math.round(at.x - (from?.side === 'in' ? NODE_WIDTH : 0)),
    y: Math.round(at.y)
  });
  const pin = from && wiringPin(def, catalog, ref, from);
  if (!from || !pin) return added;
  const link =
    from.side === 'out'
      ? { source: from.node, sourceHandle: from.pin, target: added.id, targetHandle: pin }
      : { source: added.id, sourceHandle: pin, target: from.node, targetHandle: from.pin };
  return { id: added.id, def: connect(added.def, catalog, link) };
};

export const REROUTE: NodeRef = { type: 'std.flow.reroute', version: 1 };

const KNOT_SIZE = 16;

export const insertReroute = (def: GraphDef, catalog: Catalog, id: string, at: Point) => {
  const edge = def.edges.find((e) => edgeId(e) === id);
  const end = edge && outputOf(signatureById(def, catalog, edge.from), edge.fromPin);
  if (!edge || !end?.type) return null;
  const half = KNOT_SIZE / 2;
  const added = addNode(
    def,
    REROUTE,
    { x: Math.round(at.x - half), y: Math.round(at.y - half) },
    { type: end.type }
  );
  return {
    id: added.id,
    def: {
      ...added.def,
      edges: [
        ...def.edges.filter((e) => e !== edge),
        { from: edge.from, fromPin: edge.fromPin, to: added.id, toPin: 'value' },
        { from: added.id, fromPin: 'value', to: edge.to, toPin: edge.toPin }
      ]
    }
  };
};

export const revealPin = (def: GraphDef, id: string, pin: string): GraphDef => ({
  ...def,
  nodes: def.nodes.map((n) =>
    n.id === id ? { ...n, shown: [...new Set([...(n.shown ?? []), pin])] } : n
  )
});

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

export const disconnectPin = (
  def: GraphDef,
  node: string,
  pin: string,
  side: 'in' | 'out'
): GraphDef => ({
  ...def,
  edges: def.edges.filter((e) =>
    side === 'in' ? !(e.to === node && e.toPin === pin) : !(e.from === node && e.fromPin === pin)
  )
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

export const arranged = (def: GraphDef, catalog: Catalog): GraphDef =>
  moveNodes(def, arrange(def, catalog));

export const placed = (def: GraphDef, catalog: Catalog): GraphDef => {
  if (def.nodes.every((n) => n.position)) return def;
  const missing = new Set(def.nodes.filter((n) => !n.position).map((n) => n.id));
  return moveNodes(
    def,
    Object.fromEntries(Object.entries(arrange(def, catalog)).filter(([id]) => missing.has(id)))
  );
};
