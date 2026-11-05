import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compileReport } from './report-testing.ts';
import { unbilledReport } from './unbilled-report.ts';

describe('unbilledReport', () => {
  it('ages claims not yet submitted from their service day with their oldest open task', async () => {
    const { rows } = await compileReport(unbilledReport);
    assert.ok(rows.sql.includes('"t"."status" = $'));
    assert.ok(rows.sql.includes('order by "t"."created_at" limit $'));
    assert.ok(rows.sql.includes('order by "r"."age_days" desc nulls last'));
    for (const status of ['draft', 'needs_review', 'ready']) {
      assert.ok(rows.parameters.includes(status), status);
    }
    assert.ok(!rows.parameters.includes('submitted'));
  });
});
