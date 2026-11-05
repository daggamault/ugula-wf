import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { agingReport } from './aging-report.ts';
import { compileReport } from './report-testing.ts';

describe('agingReport', () => {
  it('ages open balances from the date of service by who owes them now', async () => {
    const { rows } = await compileReport(agingReport, 'payer');
    assert.ok(rows.sql.includes('as "responsible" on true'));
    assert.ok(rows.sql.includes('($1::date - coalesce(c.service_date, c.created_at::date)) <= $2'));
    assert.ok(rows.sql.includes('coalesce(f.name, responsible.payer) as "name"'));
    assert.ok(rows.sql.includes('left join "facilities" as "f" on "f"."id" = "c"."facility_id"'));
    const byClass = await compileReport(agingReport, 'class');
    assert.ok(byClass.rows.sql.includes("coalesce(responsible.filing, '')"));
    assert.ok(byClass.rows.sql.includes("when f.id is not null then 'Facility'"));
    assert.deepEqual(rows.parameters.slice(0, 2), ['2026-10-23', 30]);
  });
});
