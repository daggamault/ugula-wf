import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compileReport } from './testing.ts';
import { writeOffsReport } from './write-offs-report.ts';

const subquery = (sql: string) =>
  sql.slice(sql.indexOf(' from (select'), sql.lastIndexOf(') as "r"') + 8);

describe('writeOffsReport', () => {
  it('is an ungrouped report over closing dates', () => {
    assert.deepEqual(
      { dates: writeOffsReport.dates, groups: writeOffsReport.groups },
      { dates: 'closed', groups: null }
    );
  });

  it('lists agency claims closed to write-off or collections in the period with their balances', async () => {
    const { rows } = await compileReport(writeOffsReport);
    assert.equal(
      rows.sql,
      'select "r"."id" as "id", "r"."closed_at" as "closed_at", "r"."claim_number" as "claim_number", "r"."pcr_number" as "pcr_number", "r"."first_name" as "first_name", "r"."last_name" as "last_name", "r"."service_date" as "service_date", "r"."outcome" as "outcome", "r"."charges_cents" as "charges_cents", "r"."paid_cents" as "paid_cents", "r"."adjusted_cents" as "adjusted_cents", "r"."balance_cents" as "balance_cents", count(*) over () as "total" from (select "e"."id", "e"."created_at" as "closed_at", "c"."number" as "claim_number", "c"."pcr_number", "p"."first_name", "p"."last_name", "c"."service_date", "e"."note" as "outcome", "c"."total_cents" as "charges_cents", "b"."paid_cents", "b"."adjusted_cents", "b"."balance_cents" from "claim_events" as "e" inner join "claims" as "c" on "c"."id" = "e"."claim_id" inner join "claim_balances" as "b" on "b"."claim_id" = "c"."id" left join "patients" as "p" on "p"."id" = "c"."patient_id" where "e"."agency_id" = $1 and "e"."kind" = $2 and "e"."note" in ($3, $4) and "e"."created_at" >= ($5::date)::timestamp at time zone $6 and "e"."created_at" < ($7::date + 1)::timestamp at time zone $8) as "r" order by "r"."closed_at" asc nulls last, "r"."id" asc limit $9 offset $10'
    );
    assert.deepEqual(rows.parameters, [
      't-1',
      'closed',
      'written_off',
      'collections',
      '2026-01-01',
      'America/New_York',
      '2026-10-23',
      'America/New_York',
      100,
      0
    ]);
  });

  it('totals charges, payments, adjustments and balances', async () => {
    const { rows, totals } = await compileReport(writeOffsReport);
    assert.equal(
      totals.sql.replace(subquery(rows.sql), ''),
      'select coalesce(sum("r"."charges_cents"), 0)::float8 as "charges_cents", coalesce(sum("r"."paid_cents"), 0)::float8 as "paid_cents", coalesce(sum("r"."adjusted_cents"), 0)::float8 as "adjusted_cents", coalesce(sum("r"."balance_cents"), 0)::float8 as "balance_cents"'
    );
    assert.deepEqual(totals.parameters, rows.parameters.slice(0, -2));
  });
});
