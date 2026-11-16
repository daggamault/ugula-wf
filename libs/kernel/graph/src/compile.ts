import type {
  Edge,
  GraphDef,
  NodeInstance,
  NodeRef,
  PinSpec,
  Signature,
  VariableDef
} from './types.ts';

export const ENTRY_TYPE = 'std.graph.entry';
export const RETURN_TYPE = 'std.graph.return';
export const INPUT_TYPE = 'std.graph.input';

export type CompiledGraph = {
  def: GraphDef;
  nodes: Map<string, NodeInstance>;
  entry: NodeInstance | undefined;
  returns: NodeInstance[];
  out: Map<string, Edge[]>;
  in: Map<string, Edge[]>;
  variables: Map<string, VariableDef>;
};

const compiled = new WeakMap<GraphDef, CompiledGraph>();

export const refKey = (ref: NodeRef) => `${ref.type}@${ref.version}`;

export const portKey = (node: string, pin: string) => `${node}:${pin}`;

const push = (map: Map<string, Edge[]>, key: string, edge: Edge) => {
  const list = map.get(key);
  if (list) list.push(edge);
  else map.set(key, [edge]);
};

export const compileGraph = (def: GraphDef): CompiledGraph => {
  const hit = compiled.get(def);
  if (hit) return hit;
  const out = new Map<string, Edge[]>();
  const into = new Map<string, Edge[]>();
  for (const e of def.edges) {
    push(out, portKey(e.from, e.fromPin), e);
    push(into, portKey(e.to, e.toPin), e);
  }
  const graph: CompiledGraph = {
    def,
    nodes: new Map(def.nodes.map((n) => [n.id, n])),
    entry: def.nodes.find((n) => n.type === ENTRY_TYPE),
    returns: def.nodes.filter((n) => n.type === RETURN_TYPE),
    out,
    in: into,
    variables: new Map(def.variables.map((v) => [v.name, v]))
  };
  compiled.set(def, graph);
  return graph;
};

export const WORKFLOW_CALL_TYPES: ReadonlySet<string> = new Set([
  'std.flow.run-workflow',
  'std.flow.start-workflow',
  'std.flow.map-workflow',
  'std.flow.spawn-workflows'
]);

export const RULE_CALL_TYPES: ReadonlySet<string> = new Set([
  'std.list.map-rule',
  'std.list.filter-rule',
  'std.list.find-rule'
]);

const refIn = (n: NodeInstance, types: ReadonlySet<string>, field: string): NodeRef | null => {
  if (!types.has(n.type)) return null;
  const c = n.config;
  if (typeof c !== 'object' || c === null || Array.isArray(c)) return null;
  const key = c[field];
  const { version } = c;
  return typeof key === 'string' && key && typeof version === 'number'
    ? { type: key, version }
    : null;
};

const workflowOf = (n: NodeInstance) => refIn(n, WORKFLOW_CALL_TYPES, 'workflow');

export const ruleRefOf = (n: NodeInstance) => refIn(n, RULE_CALL_TYPES, 'rule');

export const graphRefs = (def: GraphDef): NodeRef[] => {
  const seen = new Map<string, NodeRef>();
  for (const n of def.nodes) {
    seen.set(refKey(n), { type: n.type, version: n.version });
    const rule = ruleRefOf(n);
    if (rule) seen.set(refKey(rule), rule);
  }
  return [...seen.values()];
};

export const workflowRefs = (def: GraphDef): NodeRef[] => {
  const seen = new Map<string, NodeRef>();
  for (const n of def.nodes) {
    const ref = workflowOf(n);
    if (ref) seen.set(refKey(ref), ref);
  }
  return [...seen.values()];
};

export const retargetRefs = (def: GraphDef, versionOf: (key: string) => number | undefined) => ({
  ...def,
  nodes: def.nodes.map((n) => {
    const node = { ...n, version: versionOf(n.type) ?? n.version };
    const call = workflowOf(n) ?? ruleRefOf(n);
    const version = call && versionOf(call.type);
    return call && version ? { ...node, config: { ...(n.config as object), version } } : node;
  })
});

const pinContract = (p: PinSpec) => [p.name, p.type, p.optional === true, p.default !== undefined];

export const contractOf = (signature: Signature) =>
  JSON.stringify([
    signature.execIn,
    signature.execOut,
    signature.inputs.map(pinContract),
    signature.outputs.map(pinContract)
  ]);
