import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { invokeNode } from '../testing.ts';
import type { Values } from '../types.ts';
import { logicNodes } from './logic.ts';

const run = async (type: string, inputs: Values, config?: Values) => {
  const def = logicNodes.find((d) => d.type === type);
  if (!def) throw new Error(type);
  return (await invokeNode(def, { inputs, ...(config ? { config } : {}) })).outputs.result;
};

describe('logic nodes', () => {
  it('type the compared and chosen pins by the type chosen', () => {
    const code = { code: 'hcpcs' } as const;
    const signatureOf = (type: string) => {
      const def = logicNodes.find((d) => d.type === type);
      if (!def || typeof def.signature !== 'function') throw new Error(type);
      return def.signature(
        { type: code },
        {
          graph: {
            signature: { execIn: [], execOut: [], inputs: [], outputs: [] },
            variables: [],
            nodes: [],
            edges: []
          }
        }
      );
    };
    for (const type of ['std.logic.equal', 'std.logic.not-equal', 'std.logic.greater']) {
      assert.deepEqual(
        signatureOf(type).inputs.map((p) => p.type),
        [code, code]
      );
    }
    assert.deepEqual(signatureOf('std.logic.select').outputs[0]?.type, code);
    assert.deepEqual(
      signatureOf('std.logic.coalesce').inputs.map((p) => p.type),
      [code, code]
    );
  });

  it('compares values', async () => {
    assert.equal(await run('std.logic.equal', { a: { x: [1] }, b: { x: [1] } }), true);
    assert.equal(await run('std.logic.equal', { a: 1, b: '1' }), false);
    assert.equal(await run('std.logic.equal', {}), true);
    assert.equal(await run('std.logic.not-equal', { a: 1, b: 1 }), false);
    assert.equal(await run('std.logic.not-equal', { a: 1 }), true);
    assert.equal(await run('std.logic.less', { a: '2026-01-01', b: '2026-02-01' }), true);
    assert.equal(await run('std.logic.less', { a: 2, b: 10 }), true);
    assert.equal(await run('std.logic.greater', { a: 2, b: 2 }), false);
    assert.equal(await run('std.logic.greater-or-equal', { a: 2, b: 2 }), true);
    assert.equal(await run('std.logic.less-or-equal', { a: 'b', b: 'a' }), false);
    assert.equal(await run('std.logic.less-or-equal', { a: 'a', b: 'a' }), true);
    assert.equal(await run('std.logic.greater', { a: 3, b: 2 }), true);
    assert.equal(await run('std.logic.greater-or-equal', { a: 1, b: 2 }), false);
    assert.equal(await run('std.logic.less', { a: 2, b: 2 }), false);
    assert.equal(await run('std.logic.less', { a: '10', b: '9' }), true);
    await assert.rejects(
      () => run('std.logic.less', { a: 1, b: 'x' }),
      /Less Than: needs two numbers or two strings/
    );
    await assert.rejects(() => run('std.logic.greater', { a: true, b: false }), /two numbers/);
  });

  it('combines as many conditions as the gate is set to take', async () => {
    const three = { count: 3 };
    const all = (condition3: boolean) => ({ condition1: true, condition2: true, condition3 });
    const none = (condition3: boolean) => ({ condition1: false, condition2: false, condition3 });
    assert.equal(await run('std.logic.and', all(false), three), false);
    assert.equal(await run('std.logic.and', all(true), three), true);
    assert.equal(await run('std.logic.or', none(true), three), true);
    assert.equal(await run('std.logic.or', none(false), three), false);
    await assert.rejects(
      () => run('std.logic.and', { condition1: true, condition2: true }, three),
      /Condition 3/
    );
  });

  it('combines booleans and picks values', async () => {
    assert.equal(await run('std.logic.and', { condition1: true, condition2: false }), false);
    assert.equal(await run('std.logic.and', { condition1: true, condition2: true }), true);
    assert.equal(await run('std.logic.or', { condition1: true, condition2: false }), true);
    assert.equal(await run('std.logic.or', { condition1: false, condition2: false }), false);
    assert.equal(await run('std.logic.xor', { a: true, b: true }), false);
    assert.equal(await run('std.logic.xor', { a: false, b: true }), true);
    assert.equal(await run('std.logic.not', { value: false }), true);
    assert.equal(await run('std.logic.is-null', {}), true);
    assert.equal(await run('std.logic.is-null', { value: 0 }), false);
    assert.equal(await run('std.logic.coalesce', { fallback: 'd' }), 'd');
    assert.equal(await run('std.logic.coalesce', { value: false, fallback: 'd' }), false);
    assert.equal(await run('std.logic.coalesce', {}), null);
    assert.equal(await run('std.logic.select', { condition: false, whenTrue: 1, whenFalse: 2 }), 2);
    assert.equal(await run('std.logic.select', { condition: true, whenFalse: 2 }), null);
  });
});
