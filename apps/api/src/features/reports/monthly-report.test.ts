import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { monthlyReport } from './monthly-report.ts';
import { compileReport } from './testing.ts';

const subquery = (sql: string) =>
  sql.slice(sql.indexOf(' from (select'), sql.lastIndexOf(') as "r"') + 8);

describe('monthlyReport', () => {
  it('is an ungrouped report over service dates', () => {
    assert.deepEqual(
      { dates: monthlyReport.dates, groups: monthlyReport.groups },
      { dates: 'service', groups: null }
    );
  });

  it('sums billed agency claims served in the period by month, splitting payments and unrecovered balances', async () => {
    const { rows } = await compileReport(monthlyReport);
    assert.equal(
      rows.sql,
      `select "r"."month" as "month", "r"."claims" as "claims", "r"."charges_cents" as "charges_cents", "r"."payer_paid_cents" as "payer_paid_cents", "r"."patient_paid_cents" as "patient_paid_cents", "r"."adjusted_cents" as "adjusted_cents", "r"."written_off_cents" as "written_off_cents", "r"."collections_cents" as "collections_cents", "r"."open_balance_cents" as "open_balance_cents", "r"."billed" as "billed", "r"."bill_days" as "bill_days", count(*) over () as "total" from (select to_char(c.service_date, 'YYYY-MM') as "month", count(*)::int as "claims", coalesce(sum("c"."total_cents"), 0)::float8 as "charges_cents", coalesce(sum("x"."payer_paid"), 0)::float8 as "payer_paid_cents", coalesce(sum("x"."patient_paid"), 0)::float8 as "patient_paid_cents", coalesce(sum("x"."adjusted"), 0)::float8 as "adjusted_cents", coalesce(sum(c.total_cents - x.payer_paid - x.patient_paid - x.adjusted) filter (where c.status = 'written_off'), 0)::float8 as "written_off_cents", coalesce(sum(c.total_cents - x.payer_paid - x.patient_paid - x.adjusted) filter (where c.status = 'collections'), 0)::float8 as "collections_cents", coalesce(sum(c.total_cents - x.payer_paid - x.patient_paid - x.adjusted) filter (where c.status not in ('paid', 'written_off', 'collections', 'void')), 0)::float8 as "open_balance_cents", (count(*) filter (where x.first_submitted is not null))::int as "billed", coalesce(sum((x.first_submitted at time zone $1)::date - c.service_date), 0)::float8 as "bill_days" from "claims" as "c" inner join lateral (select coalesce(sum("e"."paid_cents") filter (where e.coverage_id is not null), 0)::float8 as "payer_paid", coalesce(sum("e"."paid_cents") filter (where e.coverage_id is null), 0)::float8 as "patient_paid", coalesce(sum("e"."adjusted_cents"), 0)::float8 as "adjusted", min(e.created_at) filter (where e.kind in ('submitted', 'resubmitted')) as "first_submitted" from "claim_events" as "e" where "e"."claim_id" = "c"."id") as "x" on true where "c"."agency_id" = $2 and "c"."status" not in ($3, $4) and c.service_date between $5::date and $6::date group by 1) as "r" order by "r"."month" asc nulls last, "r"."month" asc limit $7 offset $8`
    );
    assert.deepEqual(rows.parameters, [
      'America/New_York',
      't-1',
      'draft',
      'void',
      '2026-01-01',
      '2026-10-23',
      100,
      0
    ]);
  });

  it('totals every amount, the billed count and the days to bill', async () => {
    const { rows, totals } = await compileReport(monthlyReport);
    assert.equal(
      totals.sql.replace(subquery(rows.sql), ''),
      'select coalesce(sum("r"."claims"), 0)::float8 as "claims", coalesce(sum("r"."charges_cents"), 0)::float8 as "charges_cents", coalesce(sum("r"."payer_paid_cents"), 0)::float8 as "payer_paid_cents", coalesce(sum("r"."patient_paid_cents"), 0)::float8 as "patient_paid_cents", coalesce(sum("r"."adjusted_cents"), 0)::float8 as "adjusted_cents", coalesce(sum("r"."written_off_cents"), 0)::float8 as "written_off_cents", coalesce(sum("r"."collections_cents"), 0)::float8 as "collections_cents", coalesce(sum("r"."open_balance_cents"), 0)::float8 as "open_balance_cents", coalesce(sum("r"."billed"), 0)::float8 as "billed", coalesce(sum("r"."bill_days"), 0)::float8 as "bill_days"'
    );
    assert.deepEqual(totals.parameters, rows.parameters.slice(0, -2));
  });
});
