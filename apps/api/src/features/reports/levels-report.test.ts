import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { levelsReport } from './levels-report.ts';
import { compileReport } from './testing.ts';

const subquery = (sql: string) =>
  sql.slice(sql.indexOf(' from (select'), sql.lastIndexOf(') as "r"') + 8);

describe('levelsReport', () => {
  it('is an ungrouped report over service dates', () => {
    assert.deepEqual(
      { dates: levelsReport.dates, groups: levelsReport.groups },
      { dates: 'service', groups: null }
    );
  });

  it('sums billed agency trips, miles and charges by level and emergency', async () => {
    const { rows } = await compileReport(levelsReport);
    assert.equal(
      rows.sql,
      'select "r"."level" as "level", "r"."emergency" as "emergency", "r"."trips" as "trips", "r"."miles" as "miles", "r"."charges_cents" as "charges_cents", count(*) over () as "total" from (select "c"."level", "c"."is_emergency" as "emergency", count(*)::int as "trips", coalesce(sum(c.loaded_miles), 0)::float8 as "miles", coalesce(sum("c"."total_cents"), 0)::float8 as "charges_cents" from "claims" as "c" where "c"."agency_id" = $1 and "c"."status" not in ($2, $3) and c.service_date between $4::date and $5::date group by "c"."level", "c"."is_emergency") as "r" order by "r"."charges_cents" desc nulls last, "r"."level" desc limit $6 offset $7'
    );
    assert.deepEqual(rows.parameters, ['t-1', 'draft', 'void', '2026-01-01', '2026-10-23', 100, 0]);
  });

  it('totals trips, miles and charges', async () => {
    const { rows, totals } = await compileReport(levelsReport);
    assert.equal(
      totals.sql.replace(subquery(rows.sql), ''),
      'select coalesce(sum("r"."trips"), 0)::float8 as "trips", coalesce(sum("r"."miles"), 0)::float8 as "miles", coalesce(sum("r"."charges_cents"), 0)::float8 as "charges_cents"'
    );
    assert.deepEqual(totals.parameters, rows.parameters.slice(0, -2));
  });
});
