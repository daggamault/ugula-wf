import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hcpcsReport } from './hcpcs-report.ts';
import { compileReport } from './report-testing.ts';

describe('hcpcsReport', () => {
  it('sums charges by code over distinct claims, leaving drafts and voids out', async () => {
    const { rows, totals } = await compileReport(hcpcsReport);
    assert.ok(rows.sql.includes('count(distinct l.claim_id)::int'));
    assert.ok(rows.sql.includes('group by "l"."code"'));
    assert.ok(rows.parameters.includes('draft') && rows.parameters.includes('void'));
    assert.ok(totals.sql.includes('"r"."charges_cents"'));
  });
});
