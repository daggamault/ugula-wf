import type { TableKind } from '@ugula/db';
import {
  ENTRY_TYPE,
  type GraphDef,
  INPUT_TYPE,
  type InputBinding,
  type Json,
  type NodeInstance,
  RETURN_TYPE,
  type Signature,
  slotGraph,
  type ValueType,
  type VariableDef
} from '@ugula/graph';
import type { SeedGraph } from './graphs.ts';

type Port = `${string}.${string}`;

type NodeOptions = Pick<NodeInstance, 'label' | 'config' | 'retry'> & {
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
  const input = (id: string, pin: string) => add(id, INPUT_TYPE, { config: { pin } });
  return { add, wire, ret, input, def };
};

export const slot = (
  key: string,
  name: string,
  description: string,
  signature: Signature
): SeedGraph => ({
  key,
  name,
  kind: 'node',
  role: 'slot',
  description,
  version: 1,
  definition: slotGraph(signature)
});

export type SeedTable = {
  key: string;
  name: string;
  kind: TableKind;
  description: string;
  definition: Json;
};

type Field = { name: string; type: ValueType; label?: string };

type DecisionDefinition = {
  inputs: Field[];
  outputs: Field[];
  rules: Json[];
  otherwise: Record<string, Json>;
};

export const createTables = () => {
  const tables = new Map<string, SeedTable>();
  const decision = (
    key: string,
    name: string,
    description: string,
    definition: DecisionDefinition
  ): Json => {
    tables.set(key, { key, name, kind: 'decide', description, definition: definition as Json });
    return { inputs: definition.inputs, outputs: definition.outputs, table: { key } } as Json;
  };
  return { decision, list: () => [...tables.values()] };
};
