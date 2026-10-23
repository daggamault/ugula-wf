import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { invokeNode } from '../testing.ts';
import type { Json, Values } from '../types.ts';
import { convertNodes } from './convert.ts';

const out = async (type: string, inputs: Values, config: Json = {}) => {
  const def = convertNodes.find((d) => d.type === type);
  if (!def) throw new Error(type);
  return (await invokeNode(def, { inputs, config })).outputs;
};

describe('conversion nodes', () => {
  it('emits typed constants', async () => {
    assert.deepEqual(await out('std.value', {}, { type: 'integer', value: 5 }), { value: 5 });
    await assert.rejects(
      () => out('std.value', {}, { type: 'integer', value: 'x' }),
      /does not match/
    );
  });

  it('converts between representations', async () => {
    assert.deepEqual(await out('std.convert.to-number', { value: '12.50' }), { number: 12.5 });
    await assert.rejects(() => out('std.convert.to-number', { value: 'x' }), /Cannot convert/);
    assert.deepEqual(await out('std.convert.to-text', { value: 3 }), { text: '3' });
    assert.deepEqual(await out('std.convert.to-boolean', { value: 'false' }), { boolean: false });
    assert.deepEqual(await out('std.convert.to-boolean', { value: 'yes' }), { boolean: true });
    assert.deepEqual(await out('std.convert.parse-json', { text: '{"a":1}' }), { value: { a: 1 } });
    await assert.rejects(() => out('std.convert.parse-json', { text: '{' }), /invalid JSON/);
    assert.deepEqual(await out('std.convert.to-json', { value: [1] }), { text: '[1]' });
  });
});
