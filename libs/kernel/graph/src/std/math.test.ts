import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { invokeNode } from '../testing.ts';
import type { Json, Values } from '../types.ts';
import { mathNodes } from './math.ts';

const run = async (type: string, inputs: Values, config: Json = {}) => {
  const def = mathNodes.find((d) => d.type === type);
  if (!def) throw new Error(type);
  return (await invokeNode(def, { inputs, config })).outputs;
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
    assert.deepEqual(await run('std.math.add', { a: 1, b: null }), { result: null });
    assert.deepEqual(await run('std.math.negate', {}), { result: null });
    assert.deepEqual(await run('std.math.round', { value: null }), { result: null });
    assert.deepEqual(await run('std.math.sum', { values: [] }), { result: 0 });
  });

  it('rounds up or down without float error', async () => {
    const up = { direction: 'up' };
    const down = { direction: 'down' };
    assert.deepEqual(await run('std.math.round', { value: 12.3, digits: 1 }, up), { result: 12.3 });
    assert.deepEqual(await run('std.math.round', { value: 12.31, digits: 1 }, up), {
      result: 12.4
    });
    assert.deepEqual(await run('std.math.round', { value: 0.1 * 3, digits: 1 }, up), {
      result: 0.3
    });
    assert.deepEqual(await run('std.math.round', { value: 12.0000001, digits: 1 }, up), {
      result: 12.1
    });
    assert.deepEqual(await run('std.math.round', { value: 12.01 }, up), { result: 13 });
    assert.deepEqual(await run('std.math.round', { value: 12 }, up), { result: 12 });
    await assert.rejects(
      run('std.math.round', { value: 1, digits: 400 }, up),
      /Round: result is not a finite number/
    );
    assert.deepEqual(await run('std.math.round', { value: 1201, digits: -2 }, up), {
      result: 1300
    });
    assert.deepEqual(await run('std.math.round', { value: 12.39, digits: 1 }, down), {
      result: 12.3
    });
    assert.deepEqual(await run('std.math.round', { value: 1.1 * 3, digits: 1 }, down), {
      result: 3.3
    });
    assert.deepEqual(await run('std.math.round', { value: -1.25, digits: 1 }, down), {
      result: -1.3
    });
    assert.deepEqual(await run('std.math.round', { value: null }, up), { result: null });
    const def = mathNodes.find((d) => d.type === 'std.math.round');
    assert.equal(def?.summary?.(up), 'Round up');
    assert.equal(def?.summary?.({ direction: 'nearest' }), null);
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
