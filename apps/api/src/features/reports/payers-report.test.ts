import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { payersReport } from './payers-report.ts';
import { compileReport } from './testing.ts';

const subquery = (sql: string) =>
  sql.slice(sql.indexOf(' from (select'), sql.lastIndexOf(') as "r"') + 8);

describe('payersReport', () => {
  it('is a service-date report grouped by payer or payer class', () => {
    assert.deepEqual(
      { dates: payersReport.dates, groups: payersReport.groups },
      { dates: 'service', groups: ['payer', 'class'] }
    );
  });

  it('sums billed coverages, their denials and rejections by payer and adds a row for patient payments', async () => {
    const { rows } = await compileReport(payersReport, 'payer');
    assert.equal(
      rows.sql,
      `select "r"."name" as "name", "r"."in_directory" as "in_directory", "r"."billed" as "billed", "r"."charges_cents" as "charges_cents", "r"."paid_cents" as "paid_cents", "r"."adjusted_cents" as "adjusted_cents", "r"."responses" as "responses", "r"."denials" as "denials", "r"."rejected" as "rejected", "r"."paid_claims" as "paid_claims", "r"."pay_days" as "pay_days", count(*) over () as "total" from (select coalesce(dp.name, cc.payer_name) as "name", bool_and(cc.payer_id is not null) as "in_directory", count(*)::int as "billed", coalesce(sum("c"."total_cents"), 0)::float8 as "charges_cents", coalesce(sum("a"."paid"), 0)::float8 as "paid_cents", coalesce(sum("a"."adjusted"), 0)::float8 as "adjusted_cents", sum(a.responses)::int as "responses", sum(a.denials)::int as "denials", (count(*) filter (where a.rejections > 0))::int as "rejected", (count(*) filter (where a.first_paid >= a.first_submitted))::int as "paid_claims", coalesce(sum(extract(epoch from a.first_paid - a.first_submitted) / 86400) filter (where a.first_paid >= a.first_submitted), 0)::float8 as "pay_days" from "claim_coverages" as "cc" inner join "claims" as "c" on "c"."id" = "cc"."claim_id" left join "payers" as "dp" on "dp"."id" = "cc"."payer_id" inner join lateral (select min(e.created_at) filter (where e.kind in ('submitted', 'resubmitted')) as "first_submitted", min(e.created_at) filter (where e.kind = 'response' and e.paid_cents > 0) as "first_paid", (count(*) filter (where e.kind = 'response'))::int as "responses", (count(*) filter (where e.kind = 'denied'))::int as "denials", (count(*) filter (where e.kind = 'rejected'))::int as "rejections", coalesce(sum("e"."paid_cents"), 0)::float8 as "paid", coalesce(sum("e"."adjusted_cents"), 0)::float8 as "adjusted" from "claim_events" as "e" where "e"."coverage_id" = "cc"."id") as "a" on true left join "facilities" as "f" on "f"."id" = "c"."facility_id" where "c"."agency_id" = $1 and "c"."status" not in ($2, $3) and c.service_date between $4::date and $5::date and (a.first_submitted is not null or a.responses > 0) group by 1 union all select null as "name", true as "in_directory", 0 as "billed", 0 as "charges_cents", coalesce(sum("e"."paid_cents"), 0)::float8 as "paid_cents", coalesce(sum("e"."adjusted_cents"), 0)::float8 as "adjusted_cents", 0 as "responses", 0 as "denials", 0 as "rejected", 0 as "paid_claims", 0 as "pay_days" from "claim_events" as "e" inner join "claims" as "c" on "c"."id" = "e"."claim_id" where "c"."agency_id" = $6 and "e"."kind" = $7 and "e"."coverage_id" is null and "c"."status" not in ($8, $9) and c.service_date between $10::date and $11::date having count(*) > 0) as "r" order by "r"."paid_cents" desc nulls last, "r"."name" desc limit $12 offset $13`
    );
    assert.deepEqual(rows.parameters, [
      't-1',
      'draft',
      'void',
      '2026-01-01',
      '2026-10-23',
      't-1',
      'response',
      'draft',
      'void',
      '2026-01-01',
      '2026-10-23',
      100,
      0
    ]);
  });

  it('names payer classes by claim filing code when grouped by class', async () => {
    const byPayer = await compileReport(payersReport, 'payer');
    const byClass = await compileReport(payersReport, 'class');
    assert.equal(
      byClass.rows.sql,
      byPayer.rows.sql.replace(
        'coalesce(dp.name, cc.payer_name) as "name"',
        `coalesce(dp.claim_filing, '') as "name"`
      )
    );
    assert.notEqual(byClass.rows.sql, byPayer.rows.sql);
  });

  it('totals every count and amount', async () => {
    const { rows, totals } = await compileReport(payersReport, 'payer');
    assert.equal(
      totals.sql.replace(subquery(rows.sql), ''),
      'select coalesce(sum("r"."billed"), 0)::float8 as "billed", coalesce(sum("r"."charges_cents"), 0)::float8 as "charges_cents", coalesce(sum("r"."paid_cents"), 0)::float8 as "paid_cents", coalesce(sum("r"."adjusted_cents"), 0)::float8 as "adjusted_cents", coalesce(sum("r"."responses"), 0)::float8 as "responses", coalesce(sum("r"."denials"), 0)::float8 as "denials", coalesce(sum("r"."rejected"), 0)::float8 as "rejected", coalesce(sum("r"."paid_claims"), 0)::float8 as "paid_claims", coalesce(sum("r"."pay_days"), 0)::float8 as "pay_days"'
    );
    assert.deepEqual(totals.parameters, rows.parameters.slice(0, -2));
  });
});
