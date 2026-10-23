import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { actionNode, call, next, pin, pureNode, readInputs, suspend } from './define.ts';
import type { GraphDef, Invocation, Signature } from './types.ts';

const graph: GraphDef = {
  signature: { execIn: [], execOut: [], inputs: [], outputs: [] },
  variables: [],
  nodes: [],
  edges: []
};

const invocation = (signature: Signature, values: Record<string, number>): Invocation => ({
  config: {},
  event: { type: 'exec', pin: 'exec' },
  state: null,
  signature,
  read: async (name) => values[name] ?? null,
  vars: { get: () => null, set: () => undefined },
  ctx: { runId: 'r', key: 'k', now: new Date(0) }
});

describe('define helpers', () => {
  it('builds pins and results', () => {
    assert.deepEqual(pin('a', 'number', { optional: true }), {
      name: 'a',
      type: 'number',
      optional: true
    });
    assert.deepEqual(next('then', { x: 1 }), { type: 'next', pin: 'then', outputs: { x: 1 } });
    assert.deepEqual(next(null, {}, { done: true }).state, { done: true });
    assert.deepEqual(call('body', { i: 0 }), {
      type: 'call',
      pin: 'body',
      state: { i: 0 },
      outputs: {}
    });
    assert.equal(suspend({ kind: 'timer', data: null }).type, 'suspend');
  });

  it('creates pure and action nodes that read all inputs', async () => {
    const options = {
      type: 't.add',
      title: 'Add',
      category: 'T',
      description: '',
      inputs: [pin('a', 'number'), pin('b', 'number')],
      outputs: [pin('sum', 'number')],
      compute: ({ a, b }: Record<string, unknown>) => ({ sum: (a as number) + (b as number) })
    };
    const add = pureNode(options);
    const sig = typeof add.signature === 'function' ? add.signature({}, { graph }) : add.signature;
    assert.deepEqual(sig.execIn, []);
    assert.equal(add.version, 1);
    assert.deepEqual(await add.run(invocation(sig, { a: 1, b: 2 })), {
      type: 'next',
      pin: null,
      outputs: { sum: 3 }
    });

    const act = actionNode({ ...options, type: 't.act', effect: true });
    const actSig =
      typeof act.signature === 'function' ? act.signature({}, { graph }) : act.signature;
    assert.deepEqual([actSig.execIn, actSig.execOut, act.effect], [['exec'], ['then'], true]);
    assert.deepEqual(await readInputs(invocation(actSig, { a: 4 })), { a: 4, b: null });
  });
});
