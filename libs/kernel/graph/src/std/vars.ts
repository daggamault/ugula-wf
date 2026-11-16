import * as v from 'valibot';
import { defineNode, next, pin } from '../define.ts';
import type { GraphDef, Json, NodeDef, ValueType } from '../types.ts';

const CATEGORY = 'Variables';

const varConfig = v.object({ name: v.pipe(v.string(), v.nonEmpty()) });

type VarConfig = v.InferOutput<typeof varConfig>;

const variableSummary = ({ name }: VarConfig) => `Variable: ${name}`;

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
  description: 'Reads the current value of a variable of this workflow.',
  level: 'advanced',
  keywords: ['variable', 'read', 'get'],
  summary: variableSummary,
  config: varConfig,
  variables: ({ name }) => [name],
  signature: ({ name }, { graph }) => ({
    execIn: [],
    execOut: [],
    inputs: [],
    outputs: [
      pin('value', typeOf(graph, name), { description: 'The value the variable holds now.' })
    ]
  }),
  run: ({ vars, config }) => next(null, { value: vars.get(config.name) })
});

export const setVarNode = defineNode<VarConfig>({
  type: 'std.var.set',
  version: 1,
  title: 'Set Variable',
  category: CATEGORY,
  description: 'Remembers a value in a variable of this workflow, for later steps to read.',
  level: 'advanced',
  keywords: ['variable', 'store', 'assign', 'set'],
  summary: variableSummary,
  config: varConfig,
  variables: ({ name }) => [name],
  signature: ({ name }, { graph }) => ({
    execIn: ['exec'],
    execOut: ['then'],
    inputs: [
      pin('value', typeOf(graph, name), { optional: true, description: 'The value to remember.' })
    ],
    outputs: [pin('value', typeOf(graph, name), { description: 'The value now remembered.' })]
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
  description: 'Adds an item to the end of a list kept in a variable.',
  level: 'advanced',
  keywords: ['variable', 'push', 'add'],
  summary: variableSummary,
  config: varConfig,
  variables: ({ name }) => [name],
  signature: ({ name }, { graph }) => ({
    execIn: ['exec'],
    execOut: ['then'],
    inputs: [
      pin('item', itemTypeOf(graph, name), { optional: true, description: 'The item to add.' })
    ],
    outputs: [pin('length', 'integer', { description: 'How many items the list has now.' })]
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
  description: 'Adds an amount to a number kept in a variable.',
  level: 'advanced',
  keywords: ['variable', 'count', 'add'],
  summary: variableSummary,
  config: varConfig,
  variables: ({ name }) => [name],
  signature: {
    execIn: ['exec'],
    execOut: ['then'],
    inputs: [pin('by', 'number', { default: 1, description: 'How much to add.' })],
    outputs: [pin('value', 'number', { description: 'The new number.' })]
  },
  run: async ({ vars, read, config }) => {
    const current = vars.get(config.name);
    const value = (typeof current === 'number' ? current : 0) + ((await read('by')) as number);
    vars.set(config.name, value);
    return next('then', { value });
  }
});

export const varNodes: NodeDef[] = [getVarNode, setVarNode, appendVarNode, incrementVarNode];
