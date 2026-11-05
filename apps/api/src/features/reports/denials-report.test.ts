import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { denialsReport } from './denials-report.ts';
import { compileReport } from './report-testing.ts';

describe('denialsReport', () => {
  it('sums reason codes by payer and code, or by code alone', async () => {
    const byPayer = await compileReport(denialsReport, 'payer');
    assert.ok(byPayer.rows.sql.includes('from "claim_event_adjustments" as "a"'));
    assert.ok(byPayer.rows.sql.includes('group by 1, 2'));
    assert.ok(byPayer.rows.sql.includes('coalesce(dp.name, cc.payer_name)'));
    const byReason = await compileReport(denialsReport, 'reason');
    assert.ok(byReason.rows.sql.includes('null as "payer"'));
    assert.ok(byReason.totals.sql.includes('"r"."amount_cents"'));
  });
});
