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
    assert.deepEqual(await run('std.math.modulo', { a: 7, b: 3 }), { result: 1 });
    assert.deepEqual(await run('std.math.round', { value: 2.345, digits: 2 }), { result: 2.35 });
    assert.deepEqual(await run('std.math.round', { value: 2.5 }), { result: 3 });
    assert.deepEqual(await run('std.math.sum', { values: [1, 2, null] }), { result: 3 });
    assert.deepEqual(await run('std.math.negate', { value: 4 }), { result: -4 });
  });

  it('refuses non-finite results', async () => {
    await assert.rejects(() => run('std.math.divide', { a: 1, b: 0 }), /division by zero/);
    await assert.rejects(() => run('std.math.sqrt', { value: -1 }), /not a finite/);
    await assert.rejects(() => run('std.math.power', { a: 10, b: 400 }), /not a finite/);
  });
});
