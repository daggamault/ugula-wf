import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { invokeNode } from '../testing.ts';
import type { Values } from '../types.ts';
import { logicNodes } from './logic.ts';

const run = async (type: string, inputs: Values) => {
  const def = logicNodes.find((d) => d.type === type);
  if (!def) throw new Error(type);
  return (await invokeNode(def, { inputs })).outputs.result;
};

describe('logic nodes', () => {
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
    await assert.rejects(
      () => run('std.logic.less', { a: 1, b: 'x' }),
      /Less Than: needs two numbers or two strings/
    );
    await assert.rejects(() => run('std.logic.greater', { a: true, b: false }), /two numbers/);
  });

  it('combines booleans and picks values', async () => {
    assert.equal(await run('std.logic.and', { a: true, b: false }), false);
    assert.equal(await run('std.logic.and', { a: true, b: true }), true);
    assert.equal(await run('std.logic.or', { a: true, b: false }), true);
    assert.equal(await run('std.logic.or', { a: false, b: false }), false);
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
