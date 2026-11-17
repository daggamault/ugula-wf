import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { denialsReport } from './denials-report.ts';
import { compileReport } from './testing.ts';

const subquery = (sql: string) =>
  sql.slice(sql.indexOf(' from (select'), sql.lastIndexOf(') as "r"') + 8);

describe('denialsReport', () => {
  it('is a posting-date report grouped by payer or reason', () => {
    assert.deepEqual(
      { dates: denialsReport.dates, groups: denialsReport.groups },
      { dates: 'posted', groups: ['payer', 'reason'] }
    );
  });

  it('sums adjustment reason codes on agency responses in the period by payer and code', async () => {
    const { rows } = await compileReport(denialsReport, 'payer');
    assert.equal(
      rows.sql,
      `select "r"."payer" as "payer", "r"."code" as "code", "r"."description" as "description", "r"."adjustments" as "adjustments", "r"."denials" as "denials", "r"."claims" as "claims", "r"."amount_cents" as "amount_cents", count(*) over () as "total" from (select case when cc.id is null then null else coalesce(dp.name, cc.payer_name) end as "payer", a.group_code || '-' || a.reason_code as "code", "d"."description", count(*)::int as "adjustments", (count(distinct e.id) filter (where e.paid_cents = 0))::int as "denials", count(distinct e.claim_id)::int as "claims", coalesce(sum("a"."amount_cents"), 0)::float8 as "amount_cents" from "claim_event_adjustments" as "a" inner join "claim_events" as "e" on "e"."id" = "a"."event_id" inner join "claims" as "c" on "c"."id" = "e"."claim_id" left join "claim_coverages" as "cc" on "cc"."id" = "e"."coverage_id" left join "payers" as "dp" on "dp"."id" = "cc"."payer_id" left join "codes" as "d" on "d"."code_set" = $1 and "d"."code" = "a"."reason_code" where "e"."agency_id" = $2 and "e"."kind" = $3 and "e"."created_at" >= ($4::date)::timestamp at time zone $5 and "e"."created_at" < ($6::date + 1)::timestamp at time zone $7 group by 1, 2, 3) as "r" order by "r"."amount_cents" desc nulls last, "r"."code" desc limit $8 offset $9`
    );
    assert.deepEqual(rows.parameters, [
      'carc',
      't-1',
      'response',
      '2026-01-01',
      'America/New_York',
      '2026-10-23',
      'America/New_York',
      100,
      0
    ]);
  });

  it('sums by code alone when grouped by reason', async () => {
    const byPayer = await compileReport(denialsReport, 'payer');
    const byReason = await compileReport(denialsReport, 'reason');
    assert.equal(
      byReason.rows.sql,
      byPayer.rows.sql.replace(
        'case when cc.id is null then null else coalesce(dp.name, cc.payer_name) end as "payer"',
        'null as "payer"'
      )
    );
    assert.notEqual(byReason.rows.sql, byPayer.rows.sql);
  });

  it('totals adjustments, denials and amounts', async () => {
    const { rows, totals } = await compileReport(denialsReport);
    assert.equal(
      totals.sql.replace(subquery(rows.sql), ''),
      'select coalesce(sum("r"."adjustments"), 0)::float8 as "adjustments", coalesce(sum("r"."denials"), 0)::float8 as "denials", coalesce(sum("r"."amount_cents"), 0)::float8 as "amount_cents"'
    );
    assert.deepEqual(totals.parameters, rows.parameters.slice(0, -2));
  });
});
