import * as v from 'valibot';
import { isPure } from './registry.ts';
import type { GraphDef, Json, NodeDef, NodeEvent, Values } from './types.ts';

export type InvokeOptions = {
  config?: Json;
  inputs?: Values;
  event?: NodeEvent;
  state?: Json;
  graph?: GraphDef;
  vars?: Record<string, Json>;
  now?: Date;
};

const emptyGraph: GraphDef = {
  signature: { execIn: [], execOut: [], inputs: [], outputs: [] },
  variables: [],
  nodes: [],
  edges: []
};

export const invokeNode = async (def: NodeDef, opts: InvokeOptions = {}) => {
  const config = def.config ? v.parse(def.config, opts.config ?? {}) : {};
  const graph = opts.graph ?? emptyGraph;
  const signature =
    typeof def.signature === 'function' ? def.signature(config, { graph }) : def.signature;
  const vars = opts.vars ?? {};
  const result = await def.run({
    config,
    event: opts.event ?? (isPure(signature) ? { type: 'eval' } : { type: 'exec', pin: 'exec' }),
    state: opts.state ?? null,
    signature,
    read: async (name) =>
      opts.inputs?.[name] ?? signature.inputs.find((p) => p.name === name)?.default ?? null,
    vars: {
      get: (name) => vars[name] ?? null,
      set: (name, value) => {
        vars[name] = value;
      }
    },
    ctx: { runId: 'run', key: 'key', now: opts.now ?? new Date('2026-03-15T10:30:00.000Z') }
  });
  return {
    result,
    signature,
    outputs: result.outputs,
    pin: result.type === 'suspend' ? null : result.pin
  };
};
