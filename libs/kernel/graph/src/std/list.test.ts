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
    const indexed = await run(
      'std.list.map',
      { list: ['a', 'b'] },
      { expression: 'index + len(list)' }
    );
    assert.deepEqual(
      indexed.signature.inputs.map((p) => p.name),
      ['list']
    );
    assert.deepEqual(indexed.outputs, { list: [2, 3] });
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
      /Sort By: can only sort by numbers or strings/
    );
    await assert.rejects(
      () =>
        out(
          'std.list.map',
          { list: Array.from({ length: 100 }, (_, i) => i) },
          { expression: 'len(range(20000))' }
        ),
      /evaluation budget/
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
    assert.deepEqual(await out('std.list.get', { list: [1, 2], index: 2 }), { item: null });
    assert.deepEqual(await out('std.list.first', { list: [] }), { item: null });
    assert.deepEqual(await out('std.list.first', { list: [1, 2] }), { item: 1 });
    assert.deepEqual(await out('std.list.last', { list: [1, 2] }), { item: 2 });
    assert.deepEqual(await out('std.list.last', { list: [] }), { item: null });
    const list = [1];
    assert.deepEqual(await out('std.list.append', { list, item: 2 }), { list: [1, 2] });
    assert.deepEqual(list, [1]);
    assert.deepEqual(await out('std.list.append', { list }), { list: [1, null] });
    assert.deepEqual(await out('std.list.concat', { list: [1], other: [2] }), { list: [1, 2] });
    assert.deepEqual(await out('std.list.slice', { list: [1, 2, 3], start: 1 }), { list: [2, 3] });
    assert.deepEqual(await out('std.list.slice', { list: [1, 2, 3], end: -1 }), { list: [1, 2] });
    assert.deepEqual(await out('std.list.contains', { list: [{ a: 1 }], item: { a: 1 } }), {
      result: true
    });
    assert.deepEqual(await out('std.list.contains', { list: [1] }), { result: false });
    assert.deepEqual(await out('std.list.index-of', { list: ['a', 'b', 'b'], item: 'b' }), {
      index: 1
    });
    assert.deepEqual(await out('std.list.index-of', { list: ['a'], item: 'b' }), { index: -1 });
    assert.deepEqual(await out('std.list.reverse', { list: [1, 2] }), { list: [2, 1] });
    assert.deepEqual(await out('std.list.unique', { list: [1, 1, 2] }), { list: [1, 2] });
    assert.deepEqual(await out('std.list.unique', { list: [{ a: 1 }, { a: 1 }, '1', 1] }), {
      list: [{ a: 1 }, '1', 1]
    });
    assert.deepEqual(await out('std.list.flatten', { list: [[1], 2, [[3]]] }), {
      list: [1, 2, [3]]
    });
    assert.deepEqual(await out('std.list.range', { end: 3 }), { list: [0, 1, 2] });
    assert.deepEqual(await out('std.list.range', { start: -1, end: 1 }), { list: [-1, 0] });
    assert.deepEqual(await out('std.list.range', { start: 3, end: 1 }), { list: [] });
    assert.equal(
      ((await out('std.list.range', { end: 100_000 })).list as number[]).length,
      100_000
    );
    await assert.rejects(() => out('std.list.range', { end: 100_001 }), /Range: at most 100000/);
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
    const ascending = await invokeNode(node('std.list.sort-by-field'), {
      inputs: { list: lines, field: 'route' }
    });
    assert.deepEqual(
      (ascending.outputs.list as { code: string }[]).map((l) => l.code),
      ['A0425', 'A0398', 'A0427']
    );
    assert.deepEqual(
      (await invokeNode(node('std.list.sort-by-field'), { inputs: { list: [2, null, 1] } }))
        .outputs,
      { list: [1, 2, null] }
    );
    await assert.rejects(
      () => invokeNode(node('std.list.sort-by-field'), { inputs: { list: [{ a: 1 }] } }),
      /Sort By Field: can only sort by numbers or strings/
    );
    assert.deepEqual(
      (await invokeNode(node('std.list.where'), { inputs: { list: ['a', '', null, 'b'] } }))
        .outputs,
      { list: ['', null], count: 2 }
    );
    assert.deepEqual(
      (
        await invokeNode(node('std.list.where'), {
          inputs: { list: lines },
          config: { field: 'units', op: 'gt', value: 1 }
        })
      ).outputs,
      { list: [lines[0] ?? null], count: 1 }
    );
    assert.deepEqual(
      (await invokeNode(node('std.list.pluck'), { inputs: { list: [1, { a: 2 }], field: '' } }))
        .outputs,
      { list: [1, { a: 2 }] }
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
    const pair = await invokeNode(node('std.list.make'), { inputs: { item1: 0, item2: false } });
    assert.deepEqual(
      pair.signature.inputs.map((p) => p.name),
      ['item1', 'item2']
    );
    assert.deepEqual(pair.outputs, { list: [0, false] });
    await assert.rejects(() => invokeNode(node('std.list.make'), { config: { count: 33 } }));
    assert.deepEqual(
      (await invokeNode(node('std.list.compact'), { inputs: { list: ['a', null, ''] } })).outputs,
      { list: ['a'] }
    );
  });
});

describe('reshape', () => {
  it('copies item paths and shared values into new objects', async () => {
    const def = listNodes.find((d) => d.type === 'std.list.reshape');
    if (!def) throw new Error('reshape');
    const out = await invokeNode(def, {
      inputs: {
        list: [{ code: 'A0427', price: { cents: 100 } }],
        shared: { serviceDate: '2026-10-01' }
      },
      config: {
        fields: [
          { name: 'code', type: 'string', from: 'code' },
          { name: 'chargeCents', type: 'integer', from: 'price.cents' },
          { name: 'serviceDate', type: 'string' }
        ]
      }
    });
    assert.deepEqual(out.outputs, {
      list: [{ code: 'A0427', chargeCents: 100, serviceDate: '2026-10-01' }]
    });
    assert.deepEqual(out.signature.outputs[0]?.type, {
      list: { object: { code: 'string', chargeCents: 'integer', serviceDate: 'string' } }
    });
  });

  it('copies the whole item for an empty path and rejects invalid field lists', async () => {
    const def = listNodes.find((d) => d.type === 'std.list.reshape');
    if (!def) throw new Error('reshape');
    assert.deepEqual(
      (
        await invokeNode(def, {
          inputs: { list: ['A0427'] },
          config: { fields: [{ name: 'code', type: 'string', from: '' }] }
        })
      ).outputs,
      { list: [{ code: 'A0427' }] }
    );
    const field = { name: 'code', type: 'string' };
    for (const fields of [[], [field, field], [{ ...field, name: 'a-b' }]])
      await assert.rejects(() => invokeNode(def, { inputs: { list: [] }, config: { fields } }));
  });
});
