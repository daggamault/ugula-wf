import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RETURN_TYPE } from '../compile.ts';
import { createEngine } from '../engine.ts';
import type { GraphDef } from '../types.ts';
import { averageGraph, clampGraph, stdGraphSource } from './composites.ts';
import { createStdNodes } from './index.ts';

const harness = (type: string): GraphDef => {
  const target = stdGraphSource({ type, version: 1 });
  if (!target) throw new Error(type);
  return {
    signature: { ...target.signature, execIn: ['exec'], execOut: [] },
    variables: [],
    nodes: [
      { id: 'entry', type: 'std.graph.entry', version: 1 },
      { id: 'x', type, version: 1 },
      { id: 'ret', type: RETURN_TYPE, version: 1 }
    ],
    edges: [
      { from: 'entry', fromPin: 'exec', to: 'ret', toPin: 'exec' },
      ...target.signature.inputs.map((p) => ({
        from: 'entry',
        fromPin: p.name,
        to: 'x',
        toPin: p.name
      })),
      { from: 'x', fromPin: 'result', to: 'ret', toPin: 'result' }
    ]
  };
};

const evaluate = async (type: string, inputs: Record<string, number | number[]>) => {
  const engine = createEngine({
    nodes: createStdNodes({ fetch }),
    graphs: (ref) => (ref.type === 'harness' ? harness(type) : stdGraphSource(ref))
  });
  const state = engine.start({ type: 'harness', version: 1 }, inputs, { now: new Date(0) });
  await engine.drain(state, { runId: 'r', now: new Date(0) });
  return state.fault?.error.message ?? state.result?.outputs.result;
};

describe('std composites', () => {
  it('are registered by type and version', () => {
    assert.equal(stdGraphSource({ type: 'std.math.clamp', version: 1 }), clampGraph);
    assert.equal(stdGraphSource({ type: 'std.math.average', version: 1 }), averageGraph);
    assert.equal(stdGraphSource({ type: 'std.math.clamp', version: 2 }), undefined);
  });

  it('compute through their inner graphs', async () => {
    assert.equal(await evaluate('std.math.clamp', { value: 15, min: 0, max: 10 }), 10);
    assert.equal(await evaluate('std.math.average', { values: [2, 4, 9] }), 5);
    assert.match(String(await evaluate('std.math.average', { values: [] })), /division by zero/);
  });
});
