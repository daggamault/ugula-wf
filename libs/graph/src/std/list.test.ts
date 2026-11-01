import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { invokeNode } from '../testing.ts';
import type { Json, Values } from '../types.ts';
import { listNodes } from './list.ts';

const run = async (type: string, inputs: Values, config: Json = {}) => {
  const def = listNodes.find((d) => d.type === type);
  if (!def) throw new Error(type);
  return invokeNode(def, { inputs, config });
};

const out = async (type: string, inputs: Values, config: Json = {}) =>
  (await run(type, inputs, config)).outputs;

const lines = [
  { code: 'A0427', units: 1, charge: 900 },
  { code: 'A0425', units: 12, charge: 15 },
  { code: 'A0425', units: 0, charge: 15 }
];

describe('list nodes', () => {
  it('runs expression-driven operations with extra inputs', async () => {
    const filter = await run(
      'std.list.filter',
      { list: lines, min: 1 },
      { expression: 'item.units >= min' }
    );
    assert.deepEqual(
      filter.signature.inputs.map((p) => p.name),
      ['list', 'min']
    );
    assert.equal((filter.outputs.list as Json[]).length, 2);
    assert.deepEqual(
      await out('std.list.map', { list: lines }, { expression: 'item.units * item.charge' }),
      {
        list: [900, 180, 0]
      }
    );
    assert.deepEqual(
      await out('std.list.find', { list: lines }, { expression: 'item.units > 5' }),
      {
        item: lines[1] ?? null,
        found: true
      }
    );
    assert.deepEqual(await out('std.list.find', { list: [] }, { expression: 'true' }), {
      item: null,
      found: false
    });
    assert.deepEqual(await out('std.list.sort-by', { list: [3, 1, 2] }, { expression: 'item' }), {
      list: [1, 2, 3]
    });
    await assert.rejects(
      () => out('std.list.sort-by', { list: [{}] }, { expression: 'item' }),
      /numbers or strings/
    );
    const groups = await out('std.list.group-by', { list: lines }, { expression: 'item.code' });
    assert.deepEqual(Object.keys(groups.groups as object), ['A0427', 'A0425']);
    assert.deepEqual(
      await out('std.list.every', { list: lines }, { expression: 'item.charge > 0' }),
      {
        result: true
      }
    );
    assert.deepEqual(await out('std.list.some', { list: lines }, { expression: 'index == 2' }), {
      result: true
    });
  });

  it('reads and reshapes lists', async () => {
    assert.deepEqual(await out('std.list.length', { list: [1, 2] }), { length: 2 });
    assert.deepEqual(await out('std.list.get', { list: [1, 2], index: -1 }), { item: 2 });
    assert.deepEqual(await out('std.list.first', { list: [] }), { item: null });
    assert.deepEqual(await out('std.list.append', { list: [1], item: 2 }), { list: [1, 2] });
    assert.deepEqual(await out('std.list.concat', { list: [1], other: [2] }), { list: [1, 2] });
    assert.deepEqual(await out('std.list.slice', { list: [1, 2, 3], start: 1 }), { list: [2, 3] });
    assert.deepEqual(await out('std.list.contains', { list: [{ a: 1 }], item: { a: 1 } }), {
      result: true
    });
    assert.deepEqual(await out('std.list.index-of', { list: ['a'], item: 'b' }), { index: -1 });
    assert.deepEqual(await out('std.list.reverse', { list: [1, 2] }), { list: [2, 1] });
    assert.deepEqual(await out('std.list.unique', { list: [1, 1, 2] }), { list: [1, 2] });
    assert.deepEqual(await out('std.list.flatten', { list: [[1], 2] }), { list: [1, 2] });
    assert.deepEqual(await out('std.list.range', { end: 3 }), { list: [0, 1, 2] });
    await assert.rejects(() => out('std.list.range', { end: 1_000_000 }), /at most/);
  });
});

describe('field list nodes', () => {
  const lines = [
    { code: 'A0425', units: 4, route: '9927021' },
    { code: 'A0427', units: 1, route: null },
    { code: 'A0398', units: 1, route: '9927023' }
  ];
  const node = (type: string) => {
    const def = listNodes.find((d) => d.type === type);
    if (!def) throw new Error(type);
    return def;
  };

  it('plucks, filters, sorts and builds lists by field', async () => {
    assert.deepEqual(
      (await invokeNode(node('std.list.pluck'), { inputs: { list: lines, field: 'code' } }))
        .outputs,
      { list: ['A0425', 'A0427', 'A0398'] }
    );
    const where = await invokeNode(node('std.list.where'), {
      inputs: { list: lines },
      config: { field: 'route', op: 'oneOf', value: ['9927021', '9927023'] }
    });
    assert.equal(where.outputs.count, 2);
    const sorted = await invokeNode(node('std.list.sort-by-field'), {
      inputs: { list: lines, field: 'route', descending: true }
    });
    assert.deepEqual(
      (sorted.outputs.list as { code: string }[]).map((l) => l.code),
      ['A0398', 'A0425', 'A0427']
    );
    assert.deepEqual(
      (
        await invokeNode(node('std.list.make'), {
          inputs: { item1: 'a', item3: 'c' },
          config: { count: 3 }
        })
      ).outputs,
      { list: ['a', 'c'] }
    );
    assert.deepEqual(
      (await invokeNode(node('std.list.compact'), { inputs: { list: ['a', null, ''] } })).outputs,
      { list: ['a'] }
    );
  });
});
