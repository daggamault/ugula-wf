import type { TableKind } from '@ugula/db';
import {
  ENTRY_TYPE,
  type GraphDef,
  type Json,
  type NodeInstance,
  RETURN_TYPE,
  type Signature,
  type Trigger,
  type ValueType,
  type VariableDef
} from '@ugula/graph';

type Port = `${string}.${string}`;

type NodeOptions = Pick<NodeInstance, 'label' | 'config'> & {
  values?: Record<string, Json>;
};

const split = (port: Port) => {
  const dot = port.indexOf('.');
  return [port.slice(0, dot), port.slice(dot + 1)] as const;
};

const bindings = (fixed: Record<string, Json>) =>
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
    def.nodes.push({
      id,
      type,
      version: 1,
      ...rest,
      ...(fixed ? { inputs: bindings(fixed) } : {})
    });
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
  const trigger = (t: Trigger) => {
    const [entry] = def.nodes;
    if (entry) entry.config = { trigger: t };
  };
  return { add, wire, ret, trigger, def };
};

export type SeedTable = {
  key: string;
  name: string;
  kind: TableKind;
  description: string;
  definition: Json;
};

type LookupDefinition = {
  type: ValueType;
  rows: { key: string; value: Json }[];
  fallback?: Json;
};

export const createTables = () => {
  const tables = new Map<string, SeedTable>();
  const lookup = (key: string, name: string, description: string, definition: LookupDefinition) => {
    tables.set(key, { key, name, kind: 'lookup', description, definition: definition as Json });
    return { lookup: { type: definition.type, table: { key } } as Json, ref: { key } };
  };
  return { lookup, list: () => [...tables.values()] };
};
