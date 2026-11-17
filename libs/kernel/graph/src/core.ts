import * as v from 'valibot';
import { ENTRY_TYPE, INPUT_TYPE, RETURN_TYPE } from './compile.ts';
import { defineNode } from './define.ts';
import { entryConfigSchema, hourLabel, SCHEDULE_PERIOD_LABELS, type Trigger } from './triggers.ts';
import type { NodeDef } from './types.ts';

const handledByEngine = (): never => {
  throw new Error('Graph boundary nodes are executed by the engine');
};

export const triggerSummary = (trigger: Trigger, eventLabel: (type: string) => string) => {
  switch (trigger.kind) {
    case 'manual':
      return null;
    case 'event': {
      const tests = Object.keys(trigger.where).length;
      return `On ${eventLabel(trigger.event)}${tests ? ` (${tests === 1 ? '1 condition' : `${tests} conditions`})` : ''}`;
    }
    case 'schedule':
      return `${SCHEDULE_PERIOD_LABELS[trigger.every]} at ${hourLabel(trigger.hour)}`;
  }
};

export const entryNode = defineNode<v.InferOutput<typeof entryConfigSchema>>({
  type: ENTRY_TYPE,
  version: 1,
  title: 'Entry',
  category: 'Graph',
  description:
    'Where this workflow starts, with its inputs: when it is run, when an event happens or on a schedule.',
  level: 'basic',
  keywords: ['start', 'trigger', 'event', 'schedule'],
  config: entryConfigSchema,
  summary: ({ trigger }) => triggerSummary(trigger, (type) => type),
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
  description: 'Reads one of the inputs of this workflow, next to the steps that use it.',
  level: 'basic',
  keywords: ['input', 'parameter'],
  summary: ({ pin }) => `Input: ${pin}`,
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
  description: 'Finishes this workflow, through one of its exits, with the values connected to it.',
  level: 'basic',
  keywords: ['return', 'finish', 'end', 'output', 'exit'],
  summary: ({ pin }) => (pin ? `Exit: ${pin}` : null),
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
