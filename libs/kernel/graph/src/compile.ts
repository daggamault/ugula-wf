import type { Edge, GraphDef, NodeInstance, NodeRef, VariableDef } from './types.ts';

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

export const graphRefs = (def: GraphDef): NodeRef[] => {
  const seen = new Map<string, NodeRef>();
  for (const n of def.nodes) seen.set(refKey(n), { type: n.type, version: n.version });
  return [...seen.values()];
};
