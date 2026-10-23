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
    assert.equal(await run('std.logic.not-equal', { a: 1, b: 1 }), false);
    assert.equal(await run('std.logic.less', { a: '2026-01-01', b: '2026-02-01' }), true);
    assert.equal(await run('std.logic.greater-or-equal', { a: 2, b: 2 }), true);
    await assert.rejects(
      () => run('std.logic.less', { a: 1, b: 'x' }),
      /two numbers or two strings/
    );
  });

  it('combines booleans and picks values', async () => {
    assert.equal(await run('std.logic.and', { a: true, b: false }), false);
    assert.equal(await run('std.logic.or', { a: true, b: false }), true);
    assert.equal(await run('std.logic.xor', { a: true, b: true }), false);
    assert.equal(await run('std.logic.not', { value: false }), true);
    assert.equal(await run('std.logic.is-null', {}), true);
    assert.equal(await run('std.logic.coalesce', { fallback: 'd' }), 'd');
    assert.equal(await run('std.logic.select', { condition: false, whenTrue: 1, whenFalse: 2 }), 2);
  });
});
