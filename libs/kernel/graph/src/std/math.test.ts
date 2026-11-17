import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { invokeNode } from '../testing.ts';
import type { Json, Values } from '../types.ts';
import { mathNodes } from './math.ts';

const run = async (type: string, inputs: Values, config: Json = {}) => {
  const def = mathNodes.find((d) => d.type === type);
  assert.ok(def, type);
  return (await invokeNode(def, { inputs, config })).outputs;
};

const round = async (value: Json, digits: number | undefined, direction?: string) =>
  (
    await run(
      'std.math.round',
      digits === undefined ? { value } : { value, digits },
      direction ? { direction } : {}
    )
  ).result;

const BINARY = ['add', 'subtract', 'multiply', 'divide', 'modulo', 'power', 'min', 'max'];

const UNARY = ['abs', 'negate', 'floor', 'ceil', 'sqrt'];

describe('binary math nodes', () => {
  it('compute a result from a and b', async () => {
    const results = [];
    for (const key of BINARY) results.push((await run(`std.math.${key}`, { a: 7, b: 2 })).result);
    assert.deepEqual(results, [9, 5, 14, 3.5, 1, 49, 2, 7]);
  });

  it('keep the sign of a in a remainder', async () => {
    assert.deepEqual(await run('std.math.modulo', { a: -7, b: 3 }), { result: -1 });
  });

  it('output nothing when either number is missing', async () => {
    for (const key of BINARY) {
      assert.deepEqual(await run(`std.math.${key}`, { a: 1, b: null }), { result: null }, key);
      assert.deepEqual(await run(`std.math.${key}`, { a: null, b: 1 }), { result: null }, key);
    }
  });

  it('refuse to divide or take a remainder by zero', async () => {
    await assert.rejects(run('std.math.divide', { a: 1, b: 0 }), {
      message: 'Divide: division by zero'
    });
    await assert.rejects(run('std.math.modulo', { a: 1, b: 0 }), {
      message: 'Modulo: division by zero'
    });
  });

  it('refuse results that are not finite', async () => {
    await assert.rejects(run('std.math.power', { a: 10, b: 400 }), {
      message: 'Power: result is not a finite number'
    });
    await assert.rejects(run('std.math.add', { a: 1e308, b: 1e308 }), {
      message: 'Add: result is not a finite number'
    });
  });
});

describe('unary math nodes', () => {
  it('compute a result from the value', async () => {
    const results = [];
    for (const key of UNARY) results.push((await run(`std.math.${key}`, { value: 2.25 })).result);
    assert.deepEqual(results, [2.25, -2.25, 2, 3, 1.5]);
    assert.deepEqual(await run('std.math.abs', { value: -5 }), { result: 5 });
  });

  it('output nothing when the value is missing', async () => {
    for (const key of UNARY) {
      assert.deepEqual(await run(`std.math.${key}`, {}), { result: null }, key);
    }
  });

  it('refuse the square root of a negative number', async () => {
    await assert.rejects(run('std.math.sqrt', { value: -1 }), {
      message: 'Square Root: result is not a finite number'
    });
  });
});

describe('round node', () => {
  it('rounds to the nearest whole number by default, halves up', async () => {
    assert.equal(await round(2.5, undefined), 3);
    assert.equal(await round(2.4, undefined), 2);
  });

  it('rounds to decimal places without float error', async () => {
    assert.equal(await round(2.345, 2), 2.35);
    assert.equal(await round(1.005, 2), 1.01);
  });

  it('rounds to tens and hundreds with negative digits', async () => {
    assert.equal(await round(1250, -2), 1300);
  });

  it('rounds up, leaving exact values alone despite float error', async () => {
    assert.equal(await round(12.31, 1, 'up'), 12.4);
    assert.equal(await round(12.3, 1, 'up'), 12.3);
    assert.equal(await round(0.1 * 3, 1, 'up'), 0.3);
    assert.equal(await round(12.0000001, 1, 'up'), 12.1);
    assert.equal(await round(12.01, undefined, 'up'), 13);
    assert.equal(await round(12, undefined, 'up'), 12);
    assert.equal(await round(1201, -2, 'up'), 1300);
  });

  it('rounds down, toward negative infinity', async () => {
    assert.equal(await round(12.39, 1, 'down'), 12.3);
    assert.equal(await round(1.1 * 3, 1, 'down'), 3.3);
    assert.equal(await round(-1.25, 1, 'down'), -1.3);
  });

  it('outputs nothing for a missing value', async () => {
    assert.equal(await round(null, undefined), null);
    assert.equal(await round(null, undefined, 'up'), null);
  });

  it('refuses results that are not finite', async () => {
    await assert.rejects(round(1, 400, 'up'), { message: 'Round: result is not a finite number' });
  });

  it('rejects unknown directions', async () => {
    await assert.rejects(round(1, 0, 'sideways'));
  });

  it('names a direction other than nearest', () => {
    const def = mathNodes.find((d) => d.type === 'std.math.round');
    assert.equal(def?.summary?.({ direction: 'up' }), 'Round up');
    assert.equal(def?.summary?.({ direction: 'down' }), 'Round down');
    assert.equal(def?.summary?.({ direction: 'nearest' }), null);
  });
});

describe('sum node', () => {
  it('adds up a list, counting missing numbers as zero', async () => {
    assert.deepEqual(await run('std.math.sum', { values: [1, 2, null] }), { result: 3 });
  });

  it('sums an empty list to zero', async () => {
    assert.deepEqual(await run('std.math.sum', { values: [] }), { result: 0 });
  });

  it('refuses a total that is not finite', async () => {
    await assert.rejects(run('std.math.sum', { values: [1e308, 1e308] }), {
      message: 'Output "result" of "Sum": not a finite number'
    });
  });
});

describe('mathNodes', () => {
  it('are the basic math catalog', () => {
    assert.deepEqual(
      mathNodes.map((d) => [d.type, d.category, d.level]),
      [...BINARY, ...UNARY, 'round', 'sum'].map((k) => [`std.math.${k}`, 'Math', 'basic'])
    );
  });
});
