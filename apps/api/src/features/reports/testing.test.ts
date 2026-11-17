import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Report } from './report.ts';
import { compileReport, reportContext } from './testing.ts';

const twoQueries = (seen: unknown[]): Report => ({
  dates: null,
  groups: null,
  run: async (db, ctx, page) => {
    seen.push(ctx, page);
    const [row] = await db.selectFrom('claims').select('id').execute();
    await db.selectFrom('tasks').select('id').execute();
    return { items: [row], total: 1, page: 1, pageSize: 1, totals: {} };
  }
});

describe('reportContext', () => {
  it('is the test agency in New York, reporting this year to date', () => {
    assert.deepEqual(reportContext, {
      agencyId: 't-1',
      tz: 'America/New_York',
      now: '2026-10-23T15:00:00.000Z',
      today: '2026-10-23',
      range: { from: '2026-01-01', to: '2026-10-23' },
      group: ''
    });
  });
});

describe('compileReport', () => {
  it('runs a report for the test agency with the group and page and returns its result and queries', async () => {
    const seen: unknown[] = [];
    const { result, rows, totals } = await compileReport(twoQueries(seen), 'payer', 'all');
    assert.deepEqual(seen, [{ ...reportContext, group: 'payer' }, 'all']);
    assert.deepEqual(
      [rows.sql, totals.sql],
      ['select "id" from "claims"', 'select "id" from "tasks"']
    );
    assert.deepEqual(result, {
      items: [{ total: '1', paid_cents: 5 }],
      total: 1,
      page: 1,
      pageSize: 1,
      totals: {}
    });
  });

  it('runs ungrouped on the first page by default', async () => {
    const seen: unknown[] = [];
    await compileReport(twoQueries(seen));
    assert.deepEqual(seen, [reportContext, 1]);
  });

  it('fails a report that does not send both its rows and totals queries', async () => {
    await assert.rejects(
      compileReport({
        dates: null,
        groups: null,
        run: async () => ({ items: [], total: 0, page: 1, pageSize: 0, totals: {} })
      }),
      { name: 'AssertionError' }
    );
  });
});
