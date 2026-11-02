import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  actionNode,
  branchNode,
  call,
  type InputsOf,
  next,
  pin,
  pureNode,
  readInputs,
  suspend,
  type ValueOf
} from './define.ts';
import type { GraphDef, Invocation, Signature, Values } from './types.ts';

const graph: GraphDef = {
  signature: { execIn: [], execOut: [], inputs: [], outputs: [] },
  variables: [],
  nodes: [],
  edges: []
};

const invocation = (signature: Signature, values: Values): Invocation => ({
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
  it('infers typed inputs from pins and routes branch nodes through their exits', async () => {
    const pins = [
      pin('name', 'string'),
      pin('age', 'integer', { optional: true }),
      pin('tags', { list: 'string' })
    ] as const;
    const typed: InputsOf<typeof pins> = { name: 'a', age: null, tags: ['x', null] };
    const value: ValueOf<{ object: { n: 'number' } }> = { n: null };
    assert.deepEqual([typed.name, value.n], ['a', null]);
    const grade = branchNode({
      type: 't.grade',
      title: 'Grade',
      category: 'T',
      description: '',
      inputs: [pin('score', 'number'), pin('meta', { object: { scale: 'number' } })],
      outputs: [pin('margin', 'number')],
      exits: ['pass', 'fail'],
      compute: ({ score, meta }) =>
        score >= (meta.scale ?? 100) / 2
          ? { exit: 'pass', outputs: { margin: score - 50 } }
          : { exit: 'fail', outputs: { margin: 50 - score } }
    });
    const sig =
      typeof grade.signature === 'function' ? grade.signature({}, { graph }) : grade.signature;
    assert.deepEqual(sig.execOut, ['pass', 'fail']);
    assert.deepEqual(await grade.run(invocation(sig, { score: 70, meta: { scale: 100 } })), {
      type: 'next',
      pin: 'pass',
      outputs: { margin: 20 }
    });
    assert.equal(
      (await grade.run(invocation(sig, { score: 20, meta: { scale: 100 } }))).type,
      'next'
    );
  });
});
