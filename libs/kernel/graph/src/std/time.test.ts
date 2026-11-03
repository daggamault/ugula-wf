import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { invokeNode } from '../testing.ts';
import type { Json, Values } from '../types.ts';
import { timeNodes } from './time.ts';

const out = async (type: string, inputs: Values = {}, config: Json = {}) => {
  const def = timeNodes.find((d) => d.type === type);
  if (!def) throw new Error(type);
  return (await invokeNode(def, { inputs, config })).outputs;
};

describe('time nodes', () => {
  it('reads the step clock and date parts', async () => {
    assert.deepEqual(await out('std.time.now'), { now: '2026-03-15T10:30:00.000Z' });
    assert.deepEqual(await out('std.time.parts', { time: '2026-03-15T10:30:00Z' }), {
      date: '2026-03-15',
      year: 2026,
      month: 3,
      day: 15,
      weekday: 0,
      hour: 10,
      minute: 30
    });
    assert.deepEqual(await out('std.time.age', { birthDate: '1980-03-16' }), { years: 45 });
    assert.deepEqual(await out('std.time.age', { birthDate: '1980-03-16', at: '2026-03-16' }), {
      years: 46
    });
  });

  it('adds and measures calendar units', async () => {
    assert.deepEqual(await out('std.time.add', { time: '2026-01-31T00:00:00Z', amount: 1 }), {
      time: '2026-02-01T00:00:00.000Z'
    });
    assert.deepEqual(
      await out('std.time.add', { time: '2026-01-15T00:00:00Z', amount: 2 }, { unit: 'years' }),
      { time: '2028-01-15T00:00:00.000Z' }
    );
    const add = async (time: string, amount: number, unit: string) =>
      (await out('std.time.add', { time, amount }, { unit })).time;
    assert.equal(await add('2026-01-31T08:00:00Z', 1, 'months'), '2026-02-28T08:00:00.000Z');
    assert.equal(await add('2024-01-31T00:00:00Z', 1, 'months'), '2024-02-29T00:00:00.000Z');
    assert.equal(await add('2026-03-31T00:00:00Z', -1, 'months'), '2026-02-28T00:00:00.000Z');
    assert.equal(await add('2026-01-31T00:00:00Z', 14, 'months'), '2027-03-31T00:00:00.000Z');
    assert.equal(await add('2024-02-29T00:00:00Z', 1, 'years'), '2025-02-28T00:00:00.000Z');
    assert.equal(await add('2024-02-29T00:00:00Z', 4, 'years'), '2028-02-29T00:00:00.000Z');
    const diff = (start: string, end: string, unit: string) =>
      out('std.time.difference', { start, end }, { unit });
    assert.deepEqual(await diff('2025-03-16', '2026-03-15', 'years'), { amount: 0 });
    assert.deepEqual(await diff('2026-01-15', '2026-03-15', 'months'), { amount: 2 });
    assert.deepEqual(await diff('2026-03-15', '2026-01-16', 'months'), { amount: -1 });
    assert.deepEqual(await diff('2026-03-15T00:00:00Z', '2026-03-15T02:30:00Z', 'hours'), {
      amount: 2
    });
    assert.deepEqual(await diff('2025-03-15', '2026-03-15', 'years'), { amount: 1 });
    assert.deepEqual(await diff('2026-03-15', '2024-03-16', 'years'), { amount: -1 });
    assert.deepEqual(await diff('2026-01-15', '2026-02-14', 'months'), { amount: 0 });
    assert.deepEqual(await diff('2026-03-15T10:00:00Z', '2026-03-13T11:00:00Z', 'days'), {
      amount: -1
    });
    assert.deepEqual(await diff('2026-03-15T00:00:00Z', '2026-03-15T00:01:30Z', 'seconds'), {
      amount: 90
    });
    assert.equal(await add('2026-03-15T00:00:00Z', -90, 'minutes'), '2026-03-14T22:30:00.000Z');
    assert.equal(await add('2026-03-15T00:00:00Z', 1.5, 'days'), '2026-03-16T12:00:00.000Z');
    await assert.rejects(() => add('2026-03-15T00:00:00Z', 1, 'weeks'));
  });
});
