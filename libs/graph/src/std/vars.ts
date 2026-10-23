import * as v from 'valibot';
import { defineNode, next, pin } from '../define.ts';
import type { GraphDef, Json, NodeDef, ValueType } from '../types.ts';

const CATEGORY = 'Variables';

const varConfig = v.object({ name: v.pipe(v.string(), v.nonEmpty()) });

type VarConfig = v.InferOutput<typeof varConfig>;

const typeOf = (graph: GraphDef, name: string): ValueType =>
  graph.variables.find((x) => x.name === name)?.type ?? 'any';

const itemTypeOf = (graph: GraphDef, name: string): ValueType => {
  const t = typeOf(graph, name);
  return typeof t === 'object' && 'list' in t ? t.list : 'any';
};

export const getVarNode = defineNode<VarConfig>({
  type: 'std.var.get',
  version: 1,
  title: 'Get Variable',
  category: CATEGORY,
  description: "Reads the current value of one of this graph's variables.",
  config: varConfig,
  signature: ({ name }, { graph }) => ({
    execIn: [],
    execOut: [],
    inputs: [],
    outputs: [pin('value', typeOf(graph, name))]
  }),
  run: ({ vars, config }) => next(null, { value: vars.get(config.name) })
});

export const setVarNode = defineNode<VarConfig>({
  type: 'std.var.set',
  version: 1,
  title: 'Set Variable',
  category: CATEGORY,
  description: "Stores a value in one of this graph's variables for later nodes to read.",
  config: varConfig,
  signature: ({ name }, { graph }) => ({
    execIn: ['exec'],
    execOut: ['then'],
    inputs: [pin('value', typeOf(graph, name), { optional: true })],
    outputs: [pin('value', typeOf(graph, name))]
  }),
  run: async ({ vars, read, config }) => {
    const value = await read('value');
    vars.set(config.name, value);
    return next('then', { value });
  }
});

export const appendVarNode = defineNode<VarConfig>({
  type: 'std.var.append',
  version: 1,
  title: 'Append To Variable',
  category: CATEGORY,
  description: 'Adds an item to the end of a list variable.',
  config: varConfig,
  signature: ({ name }, { graph }) => ({
    execIn: ['exec'],
    execOut: ['then'],
    inputs: [pin('item', itemTypeOf(graph, name), { optional: true })],
    outputs: [pin('length', 'integer')]
  }),
  run: async ({ vars, read, config }) => {
    const current = vars.get(config.name);
    const list: Json[] = Array.isArray(current) ? current : [];
    const updated = [...list, await read('item')];
    vars.set(config.name, updated);
    return next('then', { length: updated.length });
  }
});

export const incrementVarNode = defineNode<VarConfig>({
  type: 'std.var.increment',
  version: 1,
  title: 'Increment Variable',
  category: CATEGORY,
  description: 'Adds an amount to a number variable and stores the result.',
  config: varConfig,
  signature: {
    execIn: ['exec'],
    execOut: ['then'],
    inputs: [pin('by', 'number', { default: 1 })],
    outputs: [pin('value', 'number')]
  },
  run: async ({ vars, read, config }) => {
    const current = vars.get(config.name);
    const value = (typeof current === 'number' ? current : 0) + ((await read('by')) as number);
    vars.set(config.name, value);
    return next('then', { value });
  }
});

export const varNodes: NodeDef[] = [getVarNode, setVarNode, appendVarNode, incrementVarNode];
