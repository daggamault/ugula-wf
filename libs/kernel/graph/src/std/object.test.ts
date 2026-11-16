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

  it('labels field pins and leaves every made field optional', async () => {
    const fields = [
      { name: 'zip', type: 'string', label: 'ZIP Code' },
      { name: 'n', type: 'number' }
    ];
    const make = await run('std.object.make', {}, { fields });
    assert.deepEqual(
      make.signature.inputs.map((p) => [p.name, p.label ?? null, p.optional ?? false]),
      [
        ['zip', 'ZIP Code', true],
        ['n', null, true]
      ]
    );
    assert.deepEqual(make.outputs, { object: { zip: null, n: null } });
    const broken = await run('std.object.break', { object: { zip: '12345' } }, { fields });
    assert.deepEqual(broken.outputs, { zip: '12345', n: null });
    assert.equal(broken.signature.outputs[0]?.label, 'ZIP Code');
  });

  it('requires the object and key inputs it reads', async () => {
    await assert.rejects(
      () => run('std.object.get', { path: 'a' }),
      /Input "object" of "Get Path" is required/
    );
    await assert.rejects(() => run('std.object.keys', {}), /Input "object" of "Keys" is required/);
    await assert.rejects(
      () => run('std.object.pick', { object: { a: 1 } }),
      /Input "keys" of "Pick" is required/
    );
    await assert.rejects(
      () => run('std.object.merge', { a: { x: 1 } }),
      /Input "b" of "Merge" is required/
    );
    assert.deepEqual(await out('std.object.has', { key: 'a' }), { result: false });
  });

  it('keeps picked fields whose value is null and ignores omitted keys that are absent', async () => {
    assert.deepEqual(await out('std.object.pick', { object: { a: null, b: 1 }, keys: ['a'] }), {
      object: { a: null }
    });
    assert.deepEqual(await out('std.object.omit', { object: { a: 1 }, keys: ['z'] }), {
      object: { a: 1 }
    });
    assert.deepEqual(await out('std.object.values', { object: {} }), { values: [] });
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
