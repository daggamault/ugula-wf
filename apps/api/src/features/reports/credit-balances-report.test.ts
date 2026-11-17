import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { creditBalancesReport } from './credit-balances-report.ts';
import { compileReport } from './testing.ts';

const subquery = (sql: string) =>
  sql.slice(sql.indexOf(' from (select'), sql.lastIndexOf(') as "r"') + 8);

describe('creditBalancesReport', () => {
  it('is an undated, ungrouped report', () => {
    assert.deepEqual(
      { dates: creditBalancesReport.dates, groups: creditBalancesReport.groups },
      { dates: null, groups: null }
    );
  });

  it('lists agency claims paid past their charges, aged from their last payment', async () => {
    const { rows } = await compileReport(creditBalancesReport);
    assert.equal(
      rows.sql,
      `select "r"."claim_number" as "claim_number", "r"."pcr_number" as "pcr_number", "r"."first_name" as "first_name", "r"."last_name" as "last_name", "r"."service_date" as "service_date", "r"."status" as "status", "r"."charges_cents" as "charges_cents", "r"."paid_cents" as "paid_cents", "r"."adjusted_cents" as "adjusted_cents", "r"."credit_cents" as "credit_cents", "r"."last_paid_at" as "last_paid_at", "r"."age_days" as "age_days", count(*) over () as "total" from (select "c"."number" as "claim_number", "c"."pcr_number", "p"."first_name", "p"."last_name", "c"."service_date", "c"."status", "c"."total_cents" as "charges_cents", "b"."paid_cents", "b"."adjusted_cents", -b.balance_cents as "credit_cents", "paid"."at" as "last_paid_at", $1::date - (paid.at at time zone $2)::date as "age_days" from "claims" as "c" inner join "claim_balances" as "b" on "b"."claim_id" = "c"."id" left join "patients" as "p" on "p"."id" = "c"."patient_id" inner join lateral (select max(e.created_at) as "at" from "claim_events" as "e" where "e"."claim_id" = "c"."id" and "e"."kind" = $3 and "e"."paid_cents" > $4) as "paid" on true where "c"."agency_id" = $5 and "b"."balance_cents" < $6) as "r" order by "r"."age_days" desc nulls last, "r"."claim_number" desc limit $7 offset $8`
    );
    assert.deepEqual(rows.parameters, [
      '2026-10-23',
      'America/New_York',
      'response',
      0,
      't-1',
      0,
      100,
      0
    ]);
  });

  it('totals only the credit', async () => {
    const { rows, totals } = await compileReport(creditBalancesReport);
    assert.equal(
      totals.sql.replace(subquery(rows.sql), ''),
      'select coalesce(sum("r"."credit_cents"), 0)::float8 as "credit_cents"'
    );
    assert.deepEqual(totals.parameters, rows.parameters.slice(0, -2));
  });
});
