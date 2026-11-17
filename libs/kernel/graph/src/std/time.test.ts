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

const add = async (time: string, amount: number, unit: string) =>
  (await out('std.time.add', { time, amount }, { unit })).time;

const diff = async (start: string, end: string, unit: string) =>
  (await out('std.time.difference', { start, end }, { unit })).amount;

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
    assert.deepEqual(await out('std.time.parts', { time: '2026-12-31T23:59:00-05:00' }), {
      date: '2027-01-01',
      year: 2027,
      month: 1,
      day: 1,
      weekday: 5,
      hour: 4,
      minute: 59
    });
  });

  it('works out an age in whole years, today or on a date', async () => {
    assert.deepEqual(await out('std.time.age', { birthDate: '1980-03-16' }), { years: 45 });
    assert.deepEqual(await out('std.time.age', { birthDate: '1980-03-15' }), { years: 46 });
    assert.deepEqual(await out('std.time.age', { birthDate: '1980-03-16', at: '2026-03-16' }), {
      years: 46
    });
  });

  it('adds days by default, and clock units exactly', async () => {
    assert.deepEqual(await out('std.time.add', { time: '2026-01-31T00:00:00Z', amount: 1 }), {
      time: '2026-02-01T00:00:00.000Z'
    });
    assert.equal(await add('2026-03-15T00:00:00Z', 1.5, 'days'), '2026-03-16T12:00:00.000Z');
    assert.equal(await add('2026-03-15T00:00:00Z', 2, 'hours'), '2026-03-15T02:00:00.000Z');
    assert.equal(await add('2026-03-15T00:00:00Z', -90, 'minutes'), '2026-03-14T22:30:00.000Z');
    assert.equal(await add('2026-03-15T00:00:00Z', 45, 'seconds'), '2026-03-15T00:00:45.000Z');
  });

  it('adds months and years, keeping to the last day of a shorter month', async () => {
    assert.equal(await add('2026-01-15T00:00:00Z', 2, 'years'), '2028-01-15T00:00:00.000Z');
    assert.equal(await add('2026-01-31T08:00:00Z', 1, 'months'), '2026-02-28T08:00:00.000Z');
    assert.equal(await add('2024-01-31T00:00:00Z', 1, 'months'), '2024-02-29T00:00:00.000Z');
    assert.equal(await add('2026-03-31T00:00:00Z', -1, 'months'), '2026-02-28T00:00:00.000Z');
    assert.equal(await add('2026-01-31T00:00:00Z', 14, 'months'), '2027-03-31T00:00:00.000Z');
    assert.equal(await add('2024-02-29T00:00:00Z', 1, 'years'), '2025-02-28T00:00:00.000Z');
    assert.equal(await add('2024-02-29T00:00:00Z', 4, 'years'), '2028-02-29T00:00:00.000Z');
  });

  it('rejects a unit it does not know', async () => {
    await assert.rejects(() => add('2026-03-15T00:00:00Z', 1, 'weeks'), /Invalid type/);
  });

  it('counts whole months and years between, negative going back', async () => {
    assert.equal(await diff('2026-01-15', '2026-03-15', 'months'), 2);
    assert.equal(await diff('2026-01-15', '2026-02-14', 'months'), 0);
    assert.equal(await diff('2026-03-15', '2026-01-16', 'months'), -1);
    assert.equal(await diff('2026-03-15', '2026-01-15', 'months'), -2);
    assert.equal(await diff('2026-01-31T12:00:00Z', '2026-02-28T11:00:00Z', 'months'), 0);
    assert.equal(await diff('2025-03-15', '2026-03-15', 'years'), 1);
    assert.equal(await diff('2025-03-16', '2026-03-15', 'years'), 0);
    assert.equal(await diff('2026-03-15', '2024-03-16', 'years'), -1);
  });

  it('counts whole clock units between, rounding toward zero', async () => {
    assert.equal(await diff('2026-03-15T00:00:00Z', '2026-03-15T02:30:00Z', 'hours'), 2);
    assert.equal(await diff('2026-03-15T10:00:00Z', '2026-03-13T11:00:00Z', 'days'), -1);
    assert.equal(await diff('2026-03-15T00:00:00Z', '2026-03-15T00:01:30Z', 'minutes'), 1);
    assert.equal(await diff('2026-03-15T00:00:00Z', '2026-03-15T00:01:30Z', 'seconds'), 90);
    assert.equal(await diff('2026-03-15', '2026-03-16', 'days'), 1);
  });
});

describe('start of and missing times', () => {
  it('finds the start of a period and passes missing times through', async () => {
    const at = { time: '2026-03-15T10:30:00Z' };
    assert.deepEqual(await out('std.time.start-of', at), { time: '2026-03-01T00:00:00.000Z' });
    assert.deepEqual(await out('std.time.start-of', at, { unit: 'year' }), {
      time: '2026-01-01T00:00:00.000Z'
    });
    assert.deepEqual(await out('std.time.start-of', at, { unit: 'day' }), {
      time: '2026-03-15T00:00:00.000Z'
    });
    assert.deepEqual(await out('std.time.start-of'), { time: null });
    assert.deepEqual(await out('std.time.add', { amount: 1 }), { time: null });
    assert.deepEqual(await out('std.time.add', { time: '2026-01-01' }), { time: null });
    assert.deepEqual(await out('std.time.difference', { start: '2026-01-01' }), { amount: null });
    assert.deepEqual(await out('std.time.difference', { end: '2026-01-01' }), { amount: null });
  });
});

describe('time summaries', () => {
  it('name the unit or period', () => {
    const summaryOf = (type: string, unit: string) =>
      timeNodes.find((n) => n.type === type)?.summary?.({ unit });
    assert.equal(summaryOf('std.time.add', 'days'), 'Adds days');
    assert.equal(summaryOf('std.time.difference', 'days'), 'In days');
    assert.equal(summaryOf('std.time.start-of', 'month'), 'Start of the month');
  });
});
