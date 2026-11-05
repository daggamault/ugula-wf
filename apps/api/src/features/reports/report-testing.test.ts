import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compileReport, reportContext } from './report-testing.ts';

describe('compileReport', () => {
  it('runs a report for the test agency and returns its rows and totals queries', async () => {
    const seen: unknown[] = [];
    const { result, rows, totals } = await compileReport(
      {
        dates: null,
        groups: null,
        run: async (db, ctx, page) => {
          seen.push(ctx.group, page);
          await db.selectFrom('claims').select('id').execute();
          await db.selectFrom('tasks').select('id').execute();
          return { items: [], total: 0, page: 1, pageSize: 0, totals: {} };
        }
      },
      'payer',
      'all'
    );
    assert.deepEqual(seen, ['payer', 'all']);
    assert.ok(rows.sql.includes('"claims"') && totals.sql.includes('"tasks"'));
    assert.equal(result.total, 0);
    assert.equal(reportContext.agencyId, 't-1');
  });
});
