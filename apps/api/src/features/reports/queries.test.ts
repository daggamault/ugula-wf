import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findReport, REPORTS } from './queries.ts';
import { compileReport } from './report-testing.ts';

describe('report queries', () => {
  it('runs every report and every part of a combined report for the agency only', async () => {
    const scoped = (sql: string) => sql.match(/"agency_id" = \$\d+/g)?.length ?? 0;
    const parts = (sql: string) => (sql.match(/union all/g)?.length ?? 0) + 1;
    for (const [id, report] of Object.entries(REPORTS)) {
      for (const group of report.groups ?? ['']) {
        const { rows, totals } = await compileReport(report, group);
        for (const q of [rows, totals]) {
          assert.equal(scoped(q.sql), parts(q.sql), `${id} ${group}`);
          assert.equal(
            q.parameters.filter((p) => p === 't-1').length,
            parts(q.sql),
            `${id} ${group}`
          );
        }
      }
    }
  });

  it('finds reports by id only', () => {
    assert.equal(findReport('aging'), REPORTS.aging);
    assert.equal(findReport('write-offs'), REPORTS['write-offs']);
    assert.equal(findReport('toString'), undefined);
  });
});
