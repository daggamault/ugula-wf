import * as v from 'valibot';
import { ENTRY_TYPE, INPUT_TYPE, RETURN_TYPE } from './compile.ts';
import { defineNode } from './define.ts';
import type { NodeDef } from './types.ts';

const handledByEngine = (): never => {
  throw new Error('Graph boundary nodes are executed by the engine');
};

export const entryNode = defineNode({
  type: ENTRY_TYPE,
  version: 1,
  title: 'Entry',
  category: 'Graph',
  description: 'Where execution and inputs enter this graph.',
  signature: (_, { graph }) => ({
    execIn: [],
    execOut: graph.signature.execIn,
    inputs: [],
    outputs: graph.signature.inputs
  }),
  run: handledByEngine
});

const inputConfig = v.object({
  pin: v.pipe(v.string(), v.nonEmpty())
});

export const inputNode = defineNode<v.InferOutput<typeof inputConfig>>({
  type: INPUT_TYPE,
  version: 1,
  title: 'Get Input',
  category: 'Graph',
  description: "Reads one of this graph's inputs next to the nodes that use it.",
  config: inputConfig,
  signature: ({ pin }, { graph }) => ({
    execIn: [],
    execOut: [],
    inputs: [],
    outputs: graph.signature.inputs.filter((p) => p.name === pin)
  }),
  run: handledByEngine
});

const returnConfig = v.object({
  pin: v.optional(v.string())
});

export const returnNode = defineNode<v.InferOutput<typeof returnConfig>>({
  type: RETURN_TYPE,
  version: 1,
  title: 'Return',
  category: 'Graph',
  description: 'Completes this graph through an exec output with its output values.',
  config: returnConfig,
  signature: (_, { graph }) => ({
    execIn: graph.signature.execIn.length ? ['exec'] : [],
    execOut: [],
    inputs: graph.signature.outputs,
    outputs: []
  }),
  run: handledByEngine
});

export const coreNodes: NodeDef[] = [entryNode, inputNode, returnNode];
