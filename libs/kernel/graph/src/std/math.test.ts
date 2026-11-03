import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { invokeNode } from '../testing.ts';
import type { Values } from '../types.ts';
import { mathNodes } from './math.ts';

const run = async (type: string, inputs: Values) => {
  const def = mathNodes.find((d) => d.type === type);
  if (!def) throw new Error(type);
  return (await invokeNode(def, { inputs })).outputs;
};

describe('math nodes', () => {
  it('computes results', async () => {
    assert.deepEqual(await run('std.math.add', { a: 2, b: 3 }), { result: 5 });
    assert.deepEqual(await run('std.math.subtract', { a: 2, b: 3 }), { result: -1 });
    assert.deepEqual(await run('std.math.multiply', { a: 2, b: 3 }), { result: 6 });
    assert.deepEqual(await run('std.math.divide', { a: 7, b: 2 }), { result: 3.5 });
    assert.deepEqual(await run('std.math.modulo', { a: 7, b: 3 }), { result: 1 });
    assert.deepEqual(await run('std.math.modulo', { a: -7, b: 3 }), { result: -1 });
    assert.deepEqual(await run('std.math.power', { a: 2, b: 10 }), { result: 1024 });
    assert.deepEqual(await run('std.math.min', { a: 2, b: -3 }), { result: -3 });
    assert.deepEqual(await run('std.math.max', { a: 2, b: -3 }), { result: 2 });
    assert.deepEqual(await run('std.math.abs', { value: -5 }), { result: 5 });
    assert.deepEqual(await run('std.math.negate', { value: 4 }), { result: -4 });
    assert.deepEqual(await run('std.math.floor', { value: -1.5 }), { result: -2 });
    assert.deepEqual(await run('std.math.ceil', { value: 1.2 }), { result: 2 });
    assert.deepEqual(await run('std.math.sqrt', { value: 9 }), { result: 3 });
  });

  it('rounds to decimal places and sums lists', async () => {
    assert.deepEqual(await run('std.math.round', { value: 2.345, digits: 2 }), { result: 2.35 });
    assert.deepEqual(await run('std.math.round', { value: 1.005, digits: 2 }), { result: 1.01 });
    assert.deepEqual(await run('std.math.round', { value: 2.5 }), { result: 3 });
    assert.deepEqual(await run('std.math.round', { value: 1250, digits: -2 }), { result: 1300 });
    assert.deepEqual(await run('std.math.sum', { values: [1, 2, null] }), { result: 3 });
    assert.deepEqual(await run('std.math.sum', { values: [] }), { result: 0 });
  });

  it('refuses non-finite results', async () => {
    await assert.rejects(() => run('std.math.divide', { a: 1, b: 0 }), /Divide: division by zero/);
    await assert.rejects(() => run('std.math.modulo', { a: 1, b: 0 }), /Modulo: division by zero/);
    await assert.rejects(() => run('std.math.sqrt', { value: -1 }), /not a finite/);
    await assert.rejects(() => run('std.math.power', { a: 10, b: 400 }), /not a finite/);
    await assert.rejects(() => run('std.math.add', { a: 1e308, b: 1e308 }), /not a finite/);
    await assert.rejects(() => run('std.math.sum', { values: [1e308, 1e308] }), /not a finite/);
  });
});
