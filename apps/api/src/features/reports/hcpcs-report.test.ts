import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hcpcsReport } from './hcpcs-report.ts';
import { compileReport } from './testing.ts';

const subquery = (sql: string) =>
  sql.slice(sql.indexOf(' from (select'), sql.lastIndexOf(') as "r"') + 8);

describe('hcpcsReport', () => {
  it('is an ungrouped report over service dates', () => {
    assert.deepEqual(
      { dates: hcpcsReport.dates, groups: hcpcsReport.groups },
      { dates: 'service', groups: null }
    );
  });

  it('sums billed agency charges by code over distinct claims served in the period', async () => {
    const { rows } = await compileReport(hcpcsReport);
    assert.equal(
      rows.sql,
      'select "r"."code" as "code", "r"."description" as "description", "r"."claims" as "claims", "r"."units" as "units", "r"."charges_cents" as "charges_cents", count(*) over () as "total" from (select "l"."code", "d"."description", count(distinct l.claim_id)::int as "claims", sum(l.units)::float8 as "units", coalesce(sum("l"."total_cents"), 0)::float8 as "charges_cents" from "claim_lines" as "l" inner join "claims" as "c" on "c"."id" = "l"."claim_id" left join "codes" as "d" on "d"."code_set" = $1 and "d"."code" = "l"."code" where "c"."agency_id" = $2 and "c"."status" not in ($3, $4) and c.service_date between $5::date and $6::date group by "l"."code", "d"."description") as "r" order by "r"."charges_cents" desc nulls last, "r"."code" desc limit $7 offset $8'
    );
    assert.deepEqual(rows.parameters, [
      'hcpcs',
      't-1',
      'draft',
      'void',
      '2026-01-01',
      '2026-10-23',
      100,
      0
    ]);
  });

  it('totals only the charges', async () => {
    const { rows, totals } = await compileReport(hcpcsReport);
    assert.equal(
      totals.sql.replace(subquery(rows.sql), ''),
      'select coalesce(sum("r"."charges_cents"), 0)::float8 as "charges_cents"'
    );
    assert.deepEqual(totals.parameters, rows.parameters.slice(0, -2));
  });
});
