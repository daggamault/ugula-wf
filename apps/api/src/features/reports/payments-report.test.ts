import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { paymentsReport } from './payments-report.ts';
import { compileReport } from './report-testing.ts';

describe('paymentsReport', () => {
  it('posts payments and refunds by posting date in the time zone with their check and reason codes', async () => {
    const { rows } = await compileReport(paymentsReport);
    assert.ok(
      rows.sql.includes(
        '"e"."created_at" >= ($5::date)::timestamp at time zone $6 and "e"."created_at" < ($7::date + 1)::timestamp at time zone $8'
      )
    );
    assert.deepEqual(rows.parameters.slice(0, 8), [
      'carc',
      't-1',
      'response',
      'refunded',
      '2026-01-01',
      'America/New_York',
      '2026-10-23',
      'America/New_York'
    ]);
    for (const column of ['"e"."paid_on"', '"e"."check_number"', '"e"."payer_claim_number"']) {
      assert.ok(rows.sql.includes(column), column);
    }
    assert.ok(rows.sql.includes("a.group_code || '-' || a.reason_code"));
    assert.ok(rows.sql.includes('left join "codes" as "d"'));
  });
});
