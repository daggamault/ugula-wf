import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compileReport } from './testing.ts';
import { unbilledReport } from './unbilled-report.ts';

const subquery = (sql: string) =>
  sql.slice(sql.indexOf(' from (select'), sql.lastIndexOf(') as "r"') + 8);

describe('unbilledReport', () => {
  it('is an undated, ungrouped report', () => {
    assert.deepEqual(
      { dates: unbilledReport.dates, groups: unbilledReport.groups },
      { dates: null, groups: null }
    );
  });

  it('ages agency claims not yet submitted from their service day with their oldest open task', async () => {
    const { rows } = await compileReport(unbilledReport);
    assert.equal(
      rows.sql,
      'select "r"."claim_number" as "claim_number", "r"."pcr_number" as "pcr_number", "r"."first_name" as "first_name", "r"."last_name" as "last_name", "r"."service_date" as "service_date", "r"."status" as "status", "r"."queue" as "queue", "r"."age_days" as "age_days", "r"."charges_cents" as "charges_cents", count(*) over () as "total" from (select "c"."number" as "claim_number", "c"."pcr_number", "p"."first_name", "p"."last_name", "c"."service_date", "c"."status", "t"."queue", $1::date - coalesce(c.service_date, (c.created_at at time zone $2)::date) as "age_days", "c"."total_cents" as "charges_cents" from "claims" as "c" left join "patients" as "p" on "p"."id" = "c"."patient_id" left join lateral (select "t"."queue" from "claim_runs" as "cr" inner join "tasks" as "t" on "t"."run_id" = "cr"."run_id" where "cr"."claim_id" = "c"."id" and "t"."status" = $3 order by "t"."created_at" limit $4) as "t" on true where "c"."agency_id" = $5 and "c"."status" in ($6, $7, $8)) as "r" order by "r"."age_days" desc nulls last, "r"."claim_number" desc limit $9 offset $10'
    );
    assert.deepEqual(rows.parameters, [
      '2026-10-23',
      'America/New_York',
      'open',
      1,
      't-1',
      'draft',
      'needs_review',
      'ready',
      100,
      0
    ]);
  });

  it('totals only the charges', async () => {
    const { rows, totals } = await compileReport(unbilledReport);
    assert.equal(
      totals.sql.replace(subquery(rows.sql), ''),
      'select coalesce(sum("r"."charges_cents"), 0)::float8 as "charges_cents"'
    );
    assert.deepEqual(totals.parameters, rows.parameters.slice(0, -2));
  });
});
