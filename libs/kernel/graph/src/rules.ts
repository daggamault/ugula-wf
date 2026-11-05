import { ENTRY_TYPE, RETURN_TYPE, refKey } from './compile.ts';
import { createEngine } from './engine.ts';
import { messageOf } from './errors.ts';
import type { GraphDef, GraphSource, NodeDef, NodeRef, Signature, Values } from './types.ts';

const HOST: NodeRef = { type: 'std.graph.rule-host', version: 1 };

export const ruleHost = (ref: NodeRef, signature: Signature): GraphDef => ({
  signature: {
    execIn: ['exec'],
    execOut: ['then'],
    inputs: signature.inputs,
    outputs: signature.outputs
  },
  variables: [],
  nodes: [
    { id: 'entry', type: ENTRY_TYPE, version: 1 },
    { id: 'rule', type: ref.type, version: ref.version },
    { id: 'return', type: RETURN_TYPE, version: 1 }
  ],
  edges: [
    { from: 'entry', fromPin: 'exec', to: 'return', toPin: 'exec' },
    ...signature.inputs.map((p) => ({ from: 'entry', fromPin: p.name, to: 'rule', toPin: p.name })),
    ...signature.outputs.map((p) => ({
      from: 'rule',
      fromPin: p.name,
      to: 'return',
      toPin: p.name
    }))
  ]
});

type RuleSource = { nodes: NodeDef[]; graphs: GraphSource };

export const runRule = async (
  { nodes, graphs }: RuleSource,
  ref: NodeRef,
  inputs: Values,
  now: Date
): Promise<Values> => {
  const def = graphs(ref);
  if (!def) throw new Error(`Rule ${refKey(ref)} is not available`);
  if (def.signature.execIn.length) throw new Error(`${refKey(ref)} is not a rule`);
  const host = ruleHost(ref, def.signature);
  const engine = createEngine({
    nodes,
    graphs: (r) => (r.type === HOST.type && r.version === HOST.version ? host : graphs(r))
  });
  const state = engine.start(HOST, inputs, { now });
  try {
    await engine.drain(state, { runId: `rule:${refKey(ref)}`, now });
  } catch (err) {
    throw new Error(`Rule ${refKey(ref)} failed: ${messageOf(err)}`);
  }
  if (state.status !== 'completed' || !state.result) {
    throw new Error(
      `Rule ${refKey(ref)} failed: ${state.fault?.error.message ?? `it ended ${state.status}`}`
    );
  }
  return state.result.outputs;
};
