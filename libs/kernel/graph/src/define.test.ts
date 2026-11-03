import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { actionNode, branchNode, call, next, pin, pureNode, suspend } from './define.ts';
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
    assert.deepEqual(suspend({ kind: 'timer', data: null }), {
      type: 'suspend',
      suspension: { kind: 'timer', data: null },
      state: null,
      outputs: {}
    });
  });

  it('derives pins from config when given a function', () => {
    const fan = pureNode<{ count: number }>({
      type: 't.fan',
      title: 'Fan',
      category: 'T',
      description: '',
      version: 2,
      inputs: [],
      outputs: ({ count }) => Array.from({ length: count }, (_, i) => pin(`out${i}`, 'number')),
      compute: () => ({})
    });
    const sig =
      typeof fan.signature === 'function' ? fan.signature({ count: 2 }, { graph }) : fan.signature;
    assert.deepEqual(
      sig.outputs.map((p) => p.name),
      ['out0', 'out1']
    );
    assert.equal(fan.version, 2);
    assert.equal(fan.config, undefined);
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
    const echo = actionNode({ ...options, compute: (inputs) => ({ sum: inputs.b ?? -1 }) });
    assert.deepEqual((await echo.run(invocation(actSig, { a: 4 }))).outputs, { sum: -1 });
  });

  it('infers typed inputs from pins and routes branch nodes through their exits', async () => {
    const pins = [
      pin('name', 'string'),
      pin('age', 'integer', { optional: true }),
      pin('tags', { list: 'string' })
    ] as const;
    const typed = pureNode({
      type: 't.typed',
      title: 'Typed',
      category: 'T',
      description: '',
      inputs: pins,
      outputs: [pin('summary', 'string')],
      compute: (inputs) => {
        const { name, age, tags }: { name: string; age: number | null; tags: (string | null)[] } =
          inputs;
        return { summary: `${name}:${age ?? '-'}:${tags.join(',')}` };
      }
    });
    const typedSig =
      typeof typed.signature === 'function' ? typed.signature({}, { graph }) : typed.signature;
    assert.deepEqual(
      (await typed.run(invocation(typedSig, { name: 'a', tags: ['x', null] }))).outputs,
      { summary: 'a:-:x,' }
    );
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
    assert.deepEqual(await grade.run(invocation(sig, { score: 20, meta: { scale: 100 } })), {
      type: 'next',
      pin: 'fail',
      outputs: { margin: 30 }
    });
    assert.equal(grade.effect, undefined);
  });
});
