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
  const page = { items: [{ balance_cents: 5 }], total: 1, page: 1, pageSize: 100 };
  const totals = { total: '1', balance_cents: 5 };
  const service = () => {
    const recording = createRecordingDb(() => [{ total: '1', balance_cents: 5 }]);
    return { ...recording, service: createReportService({ db: recording.db, now: () => now }) };
  };

  it('runs an undated report as of today in the time zone, in its first group by default', async () => {
    const { service: s, queries } = service();
    assert.deepEqual(await s.run('t-1', 'aging', { tz: 'America/New_York', page: 1 }), {
      ok: true,
      value: { asOf: '2026-10-31', range: null, group: 'payer', ...page, totals }
    });
    assert.ok(queries.every((q) => q.parameters.includes('t-1')));
  });

  it('echoes the period of a dated report, ending today when no end is given', async () => {
    const { service: s, queries } = service();
    assert.deepEqual(await s.run('t-1', 'monthly', { from: '2026-01-01', tz: 'UTC', page: 1 }), {
      ok: true,
      value: {
        asOf: '2026-11-01',
        range: { from: '2026-01-01', to: '2026-11-01' },
        group: null,
        ...page,
        totals
      }
    });
    assert.ok(queries[1]?.parameters.includes('2026-01-01'));
    assert.ok(queries[1]?.parameters.includes('2026-11-01'));
  });

  it("counts days in the agency's time zone, whatever zone the browser is in", async () => {
    const { db } = createRecordingDb((q) =>
      q.sql.includes('from "billing_profiles"')
        ? [{ time_zone: 'America/Chicago' }]
        : [{ total: '1', balance_cents: 5 }]
    );
    const aging = await createReportService({ db, now: () => now }).run('t-1', 'aging', {
      tz: 'UTC',
      page: 1
    });
    assert.equal(aging.ok && aging.value.asOf, '2026-10-31');
  });

  it('rejects unknown reports and groups a report does not offer without querying', async () => {
    const { service: s, queries } = service();
    assert.deepEqual(await s.run('t-1', 'nope', { tz: 'UTC', page: 1 }), {
      ok: false,
      failure: { code: 'not_found', message: 'There is no report called “nope”.' }
    });
    assert.deepEqual(await s.run('t-1', 'aging', { tz: 'UTC', group: 'queue', page: 1 }), {
      ok: false,
      failure: { code: 'invalid', message: "This report can't be grouped by “queue”." }
    });
    assert.deepEqual(await s.run('t-1', 'monthly', { tz: 'UTC', group: 'payer', page: 1 }), {
      ok: false,
      failure: { code: 'invalid', message: "This report can't be grouped by “payer”." }
    });
    assert.equal(queries.length, 0);
  });
});
