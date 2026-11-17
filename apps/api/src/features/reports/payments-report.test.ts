import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { paymentsReport } from './payments-report.ts';
import { compileReport } from './testing.ts';

const subquery = (sql: string) =>
  sql.slice(sql.indexOf(' from (select'), sql.lastIndexOf(') as "r"') + 8);

describe('paymentsReport', () => {
  it('is an ungrouped report over posting dates', () => {
    assert.deepEqual(
      { dates: paymentsReport.dates, groups: paymentsReport.groups },
      { dates: 'posted', groups: null }
    );
  });

  it('lists agency payments and refunds that moved money in the period with their check and reason codes', async () => {
    const { rows } = await compileReport(paymentsReport);
    assert.equal(
      rows.sql,
      `select "r"."id" as "id", "r"."posted_at" as "posted_at", "r"."claim_number" as "claim_number", "r"."pcr_number" as "pcr_number", "r"."first_name" as "first_name", "r"."last_name" as "last_name", "r"."service_date" as "service_date", "r"."payer" as "payer", "r"."filing" as "filing", "r"."kind" as "kind", "r"."paid_on" as "paid_on", "r"."check_number" as "check_number", "r"."payer_claim_number" as "payer_claim_number", "r"."paid_cents" as "paid_cents", "r"."adjusted_cents" as "adjusted_cents", "r"."reason_codes" as "reason_codes", "r"."posted_by" as "posted_by", "r"."note" as "note", count(*) over () as "total" from (select "e"."id", "e"."created_at" as "posted_at", "c"."number" as "claim_number", "c"."pcr_number", "p"."first_name", "p"."last_name", "c"."service_date", case when cc.id is null then null else coalesce(dp.name, cc.payer_name) end as "payer", "dp"."claim_filing" as "filing", "e"."kind", "e"."paid_on", "e"."check_number", "e"."payer_claim_number", "e"."paid_cents", "e"."adjusted_cents", array_to_string(array((select case when d.description is null then a.group_code || '-' || a.reason_code else d.description || ' (' || a.group_code || '-' || a.reason_code || ')' end as "code" from "claim_event_adjustments" as "a" left join "codes" as "d" on "d"."code_set" = $1 and "d"."code" = "a"."reason_code" where "a"."event_id" = "e"."id" order by "a"."position")), '; ') as "reason_codes", "u"."email" as "posted_by", "e"."note" from "claim_events" as "e" inner join "claims" as "c" on "c"."id" = "e"."claim_id" left join "patients" as "p" on "p"."id" = "c"."patient_id" left join "claim_coverages" as "cc" on "cc"."id" = "e"."coverage_id" left join "payers" as "dp" on "dp"."id" = "cc"."payer_id" left join "users" as "u" on "u"."id" = "e"."created_by_id" where "e"."agency_id" = $2 and "e"."kind" in ($3, $4) and "e"."paid_cents" <> $5 and "e"."created_at" >= ($6::date)::timestamp at time zone $7 and "e"."created_at" < ($8::date + 1)::timestamp at time zone $9) as "r" order by "r"."posted_at" asc nulls last, "r"."id" asc limit $10 offset $11`
    );
    assert.deepEqual(rows.parameters, [
      'carc',
      't-1',
      'response',
      'refunded',
      0,
      '2026-01-01',
      'America/New_York',
      '2026-10-23',
      'America/New_York',
      100,
      0
    ]);
  });

  it('totals paid and adjusted amounts', async () => {
    const { rows, totals } = await compileReport(paymentsReport);
    assert.equal(
      totals.sql.replace(subquery(rows.sql), ''),
      'select coalesce(sum("r"."paid_cents"), 0)::float8 as "paid_cents", coalesce(sum("r"."adjusted_cents"), 0)::float8 as "adjusted_cents"'
    );
    assert.deepEqual(totals.parameters, rows.parameters.slice(0, -2));
  });
});
