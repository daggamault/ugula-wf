import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RETURN_TYPE } from '../compile.ts';
import { createEngine } from '../engine.ts';
import type { GraphDef } from '../types.ts';
import { averageGraph, clampGraph, stdGraphInfo, stdGraphSource, stdGraphs } from './composites.ts';
import { createStdNodes } from './index.ts';

const harness = (type: string): GraphDef => {
  const target = stdGraphSource({ type, version: 1 });
  assert.ok(target, type);
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

describe('stdGraphSource', () => {
  it('finds each standard composite by type and version 1', () => {
    assert.equal(stdGraphSource({ type: 'std.math.clamp', version: 1 }), clampGraph);
    assert.equal(stdGraphSource({ type: 'std.math.average', version: 1 }), averageGraph);
  });

  it('finds nothing for other versions or types', () => {
    assert.equal(stdGraphSource({ type: 'std.math.clamp', version: 2 }), undefined);
    assert.equal(stdGraphSource({ type: 'std.math.median', version: 1 }), undefined);
  });
});

describe('clamp', () => {
  it('raises a value below the minimum to it', async () => {
    assert.equal(await evaluate('std.math.clamp', { value: -5, min: 0, max: 10 }), 0);
  });

  it('lowers a value above the maximum to it', async () => {
    assert.equal(await evaluate('std.math.clamp', { value: 15, min: 0, max: 10 }), 10);
  });

  it('keeps a value in range', async () => {
    assert.equal(await evaluate('std.math.clamp', { value: 5, min: 0, max: 10 }), 5);
  });
});

describe('average', () => {
  it('divides the sum of the values by their count', async () => {
    assert.equal(await evaluate('std.math.average', { values: [2, 4, 9] }), 5);
  });

  it('faults on an empty list', async () => {
    assert.equal(await evaluate('std.math.average', { values: [] }), 'Divide: division by zero');
  });
});

describe('stdGraphInfo', () => {
  it('names and describes every standard composite', () => {
    assert.deepEqual(Object.keys(stdGraphs), ['std.math.clamp@1', 'std.math.average@1']);
    assert.deepEqual(stdGraphInfo, {
      'std.math.clamp@1': {
        title: 'Clamp',
        description: 'Keeps a number between a minimum and a maximum.'
      },
      'std.math.average@1': {
        title: 'Average',
        description: 'Adds up a list of numbers and divides by how many there are.'
      }
    });
  });
});
