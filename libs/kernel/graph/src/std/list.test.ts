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

describe('formula list nodes', () => {
  it('turn the free names of the formula, other than item, index and list, into inputs', async () => {
    const filter = await run(
      'std.list.filter',
      { list: lines, min: 1 },
      { expression: 'item.units >= min' }
    );
    assert.deepEqual(
      filter.signature.inputs.map((p) => p.name),
      ['list', 'min']
    );
    assert.deepEqual(filter.outputs, { list: lines.slice(0, 2) });
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
  });

  it('map each item with a formula', async () => {
    assert.deepEqual(
      await out('std.list.map', { list: lines }, { expression: 'item.units * item.charge' }),
      { list: [900, 180, 0] }
    );
    assert.deepEqual(await out('std.list.map', {}, { expression: 'item' }), { list: [] });
  });

  it('find the first item the formula holds for', async () => {
    assert.deepEqual(
      await out('std.list.find', { list: lines }, { expression: 'item.units > 5' }),
      { item: lines[1] ?? null, found: true }
    );
    assert.deepEqual(await out('std.list.find', { list: [] }, { expression: 'true' }), {
      item: null,
      found: false
    });
    assert.deepEqual(await out('std.list.find', { list: [0, null, 'x'] }, { expression: 'item' }), {
      item: 'x',
      found: true
    });
  });

  it('test every or some item, true and false', async () => {
    const every = (expression: string) => out('std.list.every', { list: lines }, { expression });
    const some = (expression: string) => out('std.list.some', { list: lines }, { expression });
    assert.deepEqual(await every('item.charge > 0'), { result: true });
    assert.deepEqual(await every('item.units > 0'), { result: false });
    assert.deepEqual(await some('index == 2'), { result: true });
    assert.deepEqual(await some('index == 3'), { result: false });
    assert.deepEqual(await out('std.list.every', { list: [] }, { expression: 'false' }), {
      result: true
    });
    assert.deepEqual(await out('std.list.some', { list: [] }, { expression: 'true' }), {
      result: false
    });
  });

  it('sort by what the formula gives, keeping ties in order', async () => {
    assert.deepEqual(await out('std.list.sort-by', { list: [3, 1, 2] }, { expression: 'item' }), {
      list: [1, 2, 3]
    });
    assert.deepEqual(
      await out('std.list.sort-by', { list: lines }, { expression: 'item.charge' }),
      { list: [lines[1], lines[2], lines[0]] as Json[] }
    );
    await assert.rejects(
      () => out('std.list.sort-by', { list: [{}] }, { expression: 'item' }),
      /Sort by: can only sort by numbers or strings/
    );
  });

  it('group items by what the formula gives', async () => {
    assert.deepEqual(await out('std.list.group-by', { list: lines }, { expression: 'item.code' }), {
      groups: { A0427: [lines[0]], A0425: [lines[1], lines[2]] } as Json
    });
  });

  it('stop a formula that works too hard', async () => {
    await assert.rejects(
      () =>
        out(
          'std.list.map',
          { list: Array.from({ length: 100 }, (_, i) => i) },
          { expression: 'len(range(20000))' }
        ),
      /evaluation budget/
    );
  });
});

describe('reading list nodes', () => {
  it('count, get, and take the first or last item', async () => {
    assert.deepEqual(await out('std.list.length', { list: [1, 2] }), { length: 2 });
    assert.deepEqual(await out('std.list.length', {}), { length: 0 });
    assert.deepEqual(await out('std.list.get', { list: [1, 2], index: 0 }), { item: 1 });
    assert.deepEqual(await out('std.list.get', { list: [1, 2], index: -1 }), { item: 2 });
    assert.deepEqual(await out('std.list.get', { list: [1, 2], index: 2 }), { item: null });
    assert.deepEqual(await out('std.list.first', { list: [1, 2] }), { item: 1 });
    assert.deepEqual(await out('std.list.first', { list: [] }), { item: null });
    assert.deepEqual(await out('std.list.last', { list: [1, 2] }), { item: 2 });
    assert.deepEqual(await out('std.list.last', {}), { item: null });
  });

  it('find items by equal value, records included', async () => {
    assert.deepEqual(await out('std.list.contains', { list: [{ a: 1 }], item: { a: 1 } }), {
      result: true
    });
    assert.deepEqual(await out('std.list.contains', { list: [1] }), { result: false });
    assert.deepEqual(await out('std.list.contains', { list: [1, null] }), { result: true });
    assert.deepEqual(
      await out('std.list.contains-any', { list: ['a', 'b', 'c'], other: ['x', 'c', 'a'] }),
      { result: true, matches: ['c', 'a'] }
    );
    assert.deepEqual(await out('std.list.contains-any', { list: null, other: ['a'] }), {
      result: false,
      matches: []
    });
    assert.deepEqual(await out('std.list.index-of', { list: ['a', 'b', 'b'], item: 'b' }), {
      index: 1
    });
    assert.deepEqual(await out('std.list.index-of', { list: [1], item: '1' }), { index: -1 });
  });

  it('type the list and item pins by the type chosen, and pluck and flatten give any list', async () => {
    const code = { code: 'hcpcs' } as const;
    const contains = await run(
      'std.list.contains',
      { list: ['A0425'], item: 'A0425' },
      { type: code }
    );
    assert.deepEqual(
      contains.signature.inputs.map((p) => p.type),
      [{ list: code }, code]
    );
    const first = await run('std.list.first', { list: [] }, { type: code });
    assert.deepEqual(first.signature.outputs[0]?.type, code);
    const concat = await run('std.list.concat', { list: [], other: [] }, { type: code });
    assert.deepEqual(concat.signature.inputs[1]?.type, { list: code });
    const pluck = await run('std.list.pluck', { list: [], field: 'a' }, { type: code });
    assert.deepEqual(pluck.signature.outputs[0]?.type, { list: 'any' });
  });
});

describe('building list nodes', () => {
  it('append and concat without changing the list given', async () => {
    const list = [1];
    assert.deepEqual(await out('std.list.append', { list, item: 2 }), { list: [1, 2] });
    assert.deepEqual(list, [1]);
    assert.deepEqual(await out('std.list.append', { list }), { list: [1, null] });
    assert.deepEqual(await out('std.list.append', { item: 'a' }), { list: ['a'] });
    assert.deepEqual(await out('std.list.concat', { list: [1], other: [2] }), { list: [1, 2] });
  });

  it('slice from a start up to an end', async () => {
    assert.deepEqual(await out('std.list.slice', { list: [1, 2, 3] }), { list: [1, 2, 3] });
    assert.deepEqual(await out('std.list.slice', { list: [1, 2, 3], start: 1 }), { list: [2, 3] });
    assert.deepEqual(await out('std.list.slice', { list: [1, 2, 3], end: -1 }), { list: [1, 2] });
    assert.deepEqual(await out('std.list.slice', { list: [1, 2, 3], start: 2, end: 1 }), {
      list: []
    });
  });

  it('reverse, keep unique items, flatten one level and drop empty items', async () => {
    const list = [1, 2];
    assert.deepEqual(await out('std.list.reverse', { list }), { list: [2, 1] });
    assert.deepEqual(list, [1, 2]);
    assert.deepEqual(await out('std.list.unique', { list: [{ a: 1 }, { a: 1 }, '1', 1, 1] }), {
      list: [{ a: 1 }, '1', 1]
    });
    assert.deepEqual(await out('std.list.flatten', { list: [[1], 2, [[3]]] }), {
      list: [1, 2, [3]]
    });
    assert.deepEqual(await out('std.list.compact', { list: ['a', null, '', 0, false, []] }), {
      list: ['a', 0, false, []]
    });
  });

  it('list a range of whole numbers, at most 100000', async () => {
    assert.deepEqual(await out('std.list.range', { end: 3 }), { list: [0, 1, 2] });
    assert.deepEqual(await out('std.list.range', { start: -1, end: 1 }), { list: [-1, 0] });
    assert.deepEqual(await out('std.list.range', { start: 3, end: 1 }), { list: [] });
    assert.equal(
      ((await out('std.list.range', { end: 100_000 })).list as number[]).length,
      100_000
    );
    await assert.rejects(() => out('std.list.range', { end: 100_001 }), /Range: at most 100000/);
  });

  it('make a list of the filled-in values, typed and with 1 to 32 inputs', async () => {
    assert.deepEqual(await out('std.list.make', { item1: 'a', item3: 'c' }, { count: 3 }), {
      list: ['a', 'c']
    });
    const pair = await run('std.list.make', { item1: 0, item2: false });
    assert.deepEqual(
      pair.signature.inputs.map((p) => p.name),
      ['item1', 'item2']
    );
    assert.deepEqual(pair.outputs, { list: [0, false] });
    assert.deepEqual(await out('std.list.make', { item1: '', item2: [] }), { list: [[]] });
    const typed = await run('std.list.make', {}, { type: 'integer' });
    assert.deepEqual(typed.signature.outputs[0]?.type, { list: 'integer' });
    for (const count of [0, 33])
      await assert.rejects(() => run('std.list.make', {}, { count }), /Invalid value/);
  });

  it('join lists in order, skipping missing ones', async () => {
    const joined = await run(
      'std.list.join',
      { list1: ['a'], list3: ['b', 'c'] },
      { count: 3, type: 'string' }
    );
    assert.deepEqual(joined.outputs, { list: ['a', 'b', 'c'] });
    assert.deepEqual(joined.signature.inputs[0]?.type, { list: 'string' });
    assert.deepEqual(await out('std.list.join', {}), { list: [] });
  });
});

describe('field list nodes', () => {
  const trips = [
    { code: 'A0425', units: 4, route: '9927021' },
    { code: 'A0427', units: 1, route: null },
    { code: 'A0398', units: 1, route: '9927023' }
  ];
  const codes = (list: Json) => (list as { code: string }[]).map((l) => l.code);

  it('pluck the value at a path, or the item itself for no path', async () => {
    assert.deepEqual(await out('std.list.pluck', { list: trips, field: 'code' }), {
      list: ['A0425', 'A0427', 'A0398']
    });
    assert.deepEqual(await out('std.list.pluck', { list: [{ a: { b: 1 } }, {}], field: 'a.b' }), {
      list: [1, null]
    });
    assert.deepEqual(await out('std.list.pluck', { list: [1, { a: 2 }], field: '' }), {
      list: [1, { a: 2 }]
    });
  });

  it('sort by a field, smallest first or descending, with empty values last', async () => {
    const sorted = async (inputs: Values) =>
      codes((await out('std.list.sort-by-field', { list: trips, ...inputs })).list ?? null);
    assert.deepEqual(await sorted({ field: 'route' }), ['A0425', 'A0398', 'A0427']);
    assert.deepEqual(await sorted({ field: 'route', descending: true }), [
      'A0398',
      'A0425',
      'A0427'
    ]);
    assert.deepEqual(await sorted({ field: 'units' }), ['A0427', 'A0398', 'A0425']);
    assert.deepEqual(await out('std.list.sort-by-field', { list: [2, null, '', 1] }), {
      list: [1, 2, null, '']
    });
    await assert.rejects(
      () => out('std.list.sort-by-field', { list: [{ a: 1 }] }),
      /Sort by Field: can only sort by numbers or strings/
    );
  });
});

describe('reshape', () => {
  const reshape = (inputs: Values, fields: Json) => run('std.list.reshape', inputs, { fields });

  it('copies item paths and shared values into new objects', async () => {
    const out = await reshape(
      {
        list: [{ code: 'A0427', price: { cents: 100 } }, { code: 'A0425' }],
        shared: { serviceDate: '2026-10-01' }
      },
      [
        { name: 'code', type: 'string', from: 'code' },
        { name: 'chargeCents', type: 'integer', from: 'price.cents' },
        { name: 'serviceDate', type: 'string' }
      ]
    );
    assert.deepEqual(out.outputs, {
      list: [
        { code: 'A0427', chargeCents: 100, serviceDate: '2026-10-01' },
        { code: 'A0425', chargeCents: null, serviceDate: '2026-10-01' }
      ]
    });
    assert.deepEqual(out.signature.outputs[0]?.type, {
      list: { object: { code: 'string', chargeCents: 'integer', serviceDate: 'string' } }
    });
  });

  it('copies the whole item for an empty path, and nothing for a missing shared record', async () => {
    assert.deepEqual(
      (
        await reshape({ list: ['A0427'] }, [
          { name: 'code', type: 'string', from: '' },
          { name: 'date', type: 'string' }
        ])
      ).outputs,
      { list: [{ code: 'A0427', date: null }] }
    );
  });

  it('rejects empty, repeated or non-identifier field names', async () => {
    const field = { name: 'code', type: 'string' };
    for (const [fields, message] of [
      [[], /Invalid length/],
      [[field, field], /Field names must be unique/],
      [[{ ...field, name: 'a-b' }], /Names must be identifiers/]
    ] as [Json[], RegExp][]) {
      await assert.rejects(() => reshape({ list: [] }, fields), message);
    }
  });
});

describe('list summaries', () => {
  const summaryOf = (type: string, config: Json) =>
    listNodes.find((n) => n.type === type)?.summary?.(config);

  it('show the formula or fields', () => {
    assert.equal(
      summaryOf('std.list.filter', { expression: 'item.paid == false' }),
      'item.paid == false'
    );
    assert.equal(
      summaryOf('std.list.reshape', { fields: [{ name: 'code' }, { name: 'units' }] }),
      'Fields: code, units'
    );
  });
});
