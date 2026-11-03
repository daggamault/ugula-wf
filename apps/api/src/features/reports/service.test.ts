import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { createReportService, dayIn, rangeOf } from './service.ts';

const now = new Date('2026-11-01T02:00:00Z');

describe('rangeOf', () => {
  it('defaults to the last twelve months, from the first of the month', () => {
    assert.deepEqual(rangeOf({}, '2026-10-23'), { from: '2025-11-01', to: '2026-10-23' });
    assert.deepEqual(rangeOf({ to: '2026-03-31' }, '2026-10-23'), {
      from: '2025-04-01',
      to: '2026-03-31'
    });
    assert.deepEqual(rangeOf({ from: '2026-01-01', to: '2026-01-31' }, '2026-10-23'), {
      from: '2026-01-01',
      to: '2026-01-31'
    });
  });
});

describe('dayIn', () => {
  it('reads the calendar day in a time zone', () => {
    assert.equal(dayIn(now, 'UTC'), '2026-11-01');
    assert.equal(dayIn(now, 'America/New_York'), '2026-10-31');
  });
});

describe('report service', () => {
  const service = () => {
    const recording = createRecordingDb(() => [{ total: '1', balance_cents: 5 }]);
    return { ...recording, service: createReportService({ db: recording.db, now: () => now }) };
  };

  it('runs a report as of today in the time zone, echoing its period and group', async () => {
    const { service: s, queries } = service();
    const aging = await s.run('t-1', 'aging', { tz: 'America/New_York', page: 1 });
    assert.ok(aging.ok);
    assert.equal(aging.value.asOf, '2026-10-31');
    assert.equal(aging.value.range, null);
    assert.equal(aging.value.group, 'payer');
    assert.equal(aging.value.total, 1);
    const monthly = await s.run('t-1', 'monthly', { from: '2026-01-01', tz: 'UTC', page: 1 });
    assert.ok(monthly.ok);
    assert.deepEqual(monthly.value.range, { from: '2026-01-01', to: '2026-11-01' });
    assert.equal(monthly.value.group, null);
    assert.ok(queries.every((q) => q.parameters.includes('t-1')));
  });

  it('rejects unknown reports and groups a report does not offer', async () => {
    const { service: s } = service();
    const missing = await s.run('t-1', 'nope', { tz: 'UTC', page: 1 });
    assert.ok(!missing.ok && missing.failure.code === 'not_found');
    const badGroup = await s.run('t-1', 'aging', { tz: 'UTC', group: 'queue', page: 1 });
    assert.ok(!badGroup.ok && badGroup.failure.code === 'invalid');
    const ungrouped = await s.run('t-1', 'monthly', { tz: 'UTC', group: 'payer', page: 1 });
    assert.ok(!ungrouped.ok && ungrouped.failure.code === 'invalid');
  });
});
