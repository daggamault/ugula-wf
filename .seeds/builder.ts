import {
  ENTRY_TYPE,
  type GraphDef,
  type InputBinding,
  type Json,
  type NodeInstance,
  RETURN_TYPE,
  type Signature,
  type VariableDef
} from '@ugula/graph';

export type Port = `${string}.${string}`;

export type NodeOptions = Pick<NodeInstance, 'label' | 'config' | 'retry'> & {
  values?: Record<string, Json>;
};

const split = (port: Port) => {
  const dot = port.indexOf('.');
  return [port.slice(0, dot), port.slice(dot + 1)] as const;
};

export const values = (fixed: Record<string, Json>): Record<string, InputBinding> =>
  Object.fromEntries(Object.entries(fixed).map(([k, value]) => [k, { value }]));

export const graph = (signature: Signature, variables: VariableDef[] = []) => {
  const def: GraphDef = {
    signature,
    variables,
    nodes: [{ id: 'entry', type: ENTRY_TYPE, version: 1 }],
    edges: []
  };
  const add = (id: string, type: string, { values: fixed, ...rest }: NodeOptions = {}) => {
    if (id.includes('.')) throw new Error(`Node ids cannot contain dots: ${id}`);
    if (def.nodes.some((n) => n.id === id)) throw new Error(`Duplicate node ${id}`);
    def.nodes.push({ id, type, version: 1, ...rest, ...(fixed ? { inputs: values(fixed) } : {}) });
    return id;
  };
  const wire = (from: Port, ...to: Port[]) => {
    const [node, pin] = split(from);
    for (const port of to) {
      const [toNode, toPin] = split(port);
      def.edges.push({ from: node, fromPin: pin, to: toNode, toPin });
    }
  };
  const ret = (id: string, pin?: string) => add(id, RETURN_TYPE, pin ? { config: { pin } } : {});
  return { add, wire, ret, def };
};
