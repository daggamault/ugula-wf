import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { monthlyReport } from './monthly-report.ts';
import { compileReport } from './report-testing.ts';

describe('monthlyReport', () => {
  it('filters service dates on the indexed column and splits unrecovered balances', async () => {
    const { rows, totals } = await compileReport(monthlyReport);
    assert.ok(rows.sql.includes('c.service_date between $'));
    assert.ok(!rows.sql.includes('coalesce(c.service_date'));
    assert.ok(
      rows.sql.includes("c.status = 'written_off'") && rows.sql.includes("c.status = 'collections'")
    );
    assert.ok(totals.sql.includes('"r"."bill_days"'));
  });
});
