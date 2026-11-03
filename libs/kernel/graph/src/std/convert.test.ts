import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { invokeNode } from '../testing.ts';
import type { Json, Values } from '../types.ts';
import { convertNodes } from './convert.ts';

const run = (type: string, inputs: Values, config: Json = {}) => {
  const def = convertNodes.find((d) => d.type === type);
  if (!def) throw new Error(type);
  return invokeNode(def, { inputs, config });
};

const out = async (type: string, inputs: Values, config: Json = {}) =>
  (await run(type, inputs, config)).outputs;

describe('conversion nodes', () => {
  it('emits typed constants', async () => {
    assert.deepEqual(await out('std.value', {}, { type: 'integer', value: 5 }), { value: 5 });
    const list = await run('std.value', {}, { type: { list: 'string' }, value: ['a'] });
    assert.deepEqual(list.signature.outputs, [{ name: 'value', type: { list: 'string' } }]);
    assert.deepEqual(list.outputs, { value: ['a'] });
    await assert.rejects(
      () => out('std.value', {}, { type: 'integer', value: 'x' }),
      /does not match/
    );
    await assert.rejects(() => out('std.value', {}, { type: 'integer', value: 1.5 }), /does not/);
  });

  it('converts between representations', async () => {
    assert.deepEqual(await out('std.convert.to-number', { value: '12.50' }), { number: 12.5 });
    assert.deepEqual(await out('std.convert.to-number', { value: -3 }), { number: -3 });
    await assert.rejects(() => out('std.convert.to-number', { value: 'x' }), /Cannot convert/);
    await assert.rejects(() => out('std.convert.to-number', { value: ' ' }), /Cannot convert/);
    assert.deepEqual(await out('std.convert.to-text', { value: 3 }), { text: '3' });
    assert.deepEqual(await out('std.convert.to-text', {}), { text: '' });
    for (const value of [null, false, 0, '', 'false'])
      assert.deepEqual(await out('std.convert.to-boolean', { value }), { boolean: false });
    for (const value of ['yes', '0', 1, [], {}])
      assert.deepEqual(await out('std.convert.to-boolean', { value }), { boolean: true });
    assert.deepEqual(await out('std.convert.parse-json', { text: '{"a":1}' }), { value: { a: 1 } });
    await assert.rejects(() => out('std.convert.parse-json', { text: '{' }), /invalid JSON/);
    assert.deepEqual(await out('std.convert.to-json', { value: [1] }), { text: '[1]' });
    assert.deepEqual(await out('std.convert.to-json', {}), { text: 'null' });
  });
});
