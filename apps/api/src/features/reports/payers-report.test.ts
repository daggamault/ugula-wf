import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { payersReport } from './payers-report.ts';
import { compileReport } from './report-testing.ts';

describe('payersReport', () => {
  it('adds the patient to payer performance and counts only billed coverages', async () => {
    const { rows } = await compileReport(payersReport, 'payer');
    assert.ok(rows.sql.includes('union all'));
    assert.ok(rows.sql.includes('a.first_submitted is not null or a.responses > 0'));
    assert.ok(rows.sql.includes('"e"."coverage_id" is null'));
    assert.ok(
      rows.sql.includes('e.paid_cents = 0 and exists (select 1 from claim_event_adjustments a')
    );
    const byClass = await compileReport(payersReport, 'class');
    assert.ok(byClass.rows.sql.includes("coalesce(dp.claim_filing, '')"));
  });
});
