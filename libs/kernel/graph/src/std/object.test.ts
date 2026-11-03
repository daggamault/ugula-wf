import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { invokeNode } from '../testing.ts';
import type { Json, Values } from '../types.ts';
import { objectNodes } from './object.ts';

const run = async (type: string, inputs: Values, config: Json = {}) => {
  const def = objectNodes.find((d) => d.type === type);
  if (!def) throw new Error(type);
  return invokeNode(def, { inputs, config });
};

const out = async (type: string, inputs: Values, config: Json = {}) =>
  (await run(type, inputs, config)).outputs;

describe('object nodes', () => {
  it('makes and breaks typed objects', async () => {
    const fields = [
      { name: 'id', type: 'string' },
      { name: 'age', type: 'integer' }
    ];
    const make = await run('std.object.make', { id: 'p1', age: 40 }, { fields });
    assert.deepEqual(make.outputs, { object: { id: 'p1', age: 40 } });
    assert.deepEqual(make.signature.outputs[0]?.type, { object: { id: 'string', age: 'integer' } });
    assert.deepEqual(await out('std.object.break', { object: { id: 'p1' } }, { fields }), {
      id: 'p1',
      age: null
    });
    await assert.rejects(() => run('std.object.make', {}, { fields: [...fields, ...fields] }));
  });

  it('reads, writes and reshapes fields', async () => {
    assert.deepEqual(await out('std.object.get', { object: { a: { b: 1 } }, path: 'a.b' }), {
      value: 1,
      found: true
    });
    assert.deepEqual(await out('std.object.get', { object: { a: [{ b: 1 }] }, path: 'a.0.b' }), {
      value: 1,
      found: true
    });
    assert.deepEqual(await out('std.object.get', { object: { a: 1 }, path: 'a.b' }), {
      value: null,
      found: false
    });
    const original = { a: 1 };
    assert.deepEqual(await out('std.object.set', { object: original, path: 'b.c', value: 2 }), {
      object: { a: 1, b: { c: 2 } }
    });
    assert.deepEqual(original, { a: 1 });
    assert.deepEqual(await out('std.object.set', { path: 'a' }), { object: { a: null } });
    assert.deepEqual(await out('std.object.merge', { a: { x: 1 }, b: { x: 2, y: 3 } }), {
      object: { x: 2, y: 3 }
    });
    assert.deepEqual(await out('std.object.keys', { object: { a: 1 } }), { keys: ['a'] });
    assert.deepEqual(await out('std.object.values', { object: { a: 1 } }), { values: [1] });
    assert.deepEqual(await out('std.object.has', { object: { a: 1 }, key: 'a' }), { result: true });
    assert.deepEqual(await out('std.object.has', { object: {}, key: 'toString' }), {
      result: false
    });
    assert.deepEqual(await out('std.object.has', { object: ['a'], key: '0' }), { result: false });
    assert.deepEqual(await out('std.object.pick', { object: { a: 1, b: 2 }, keys: ['b', 'z'] }), {
      object: { b: 2 }
    });
    assert.deepEqual(await out('std.object.omit', { object: { a: 1, b: 2 }, keys: ['a'] }), {
      object: { b: 2 }
    });
  });
});
