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

  it('counts agency denials in the period by payer and the reason codes on their remittance', async () => {
    const { rows } = await compileReport(denialsReport, 'payer');
    assert.equal(
      rows.sql,
      `select "r"."payer" as "payer", "r"."code" as "code", "r"."description" as "description", "r"."denials" as "denials", "r"."claims" as "claims", "r"."amount_cents" as "amount_cents", count(*) over () as "total" from (select coalesce(dp.name, cc.payer_name) as "payer", a.group_code || '-' || a.reason_code as "code", "d"."description", count(distinct dn.id)::int as "denials", count(distinct dn.claim_id)::int as "claims", coalesce(sum("a"."amount_cents"), 0)::float8 as "amount_cents" from "claim_events" as "dn" inner join "claim_events" as "e" on "e"."claim_id" = "dn"."claim_id" and e.source_key || ':denied' = dn.source_key inner join "claim_coverages" as "cc" on "cc"."id" = "dn"."coverage_id" left join "payers" as "dp" on "dp"."id" = "cc"."payer_id" left join "claim_event_adjustments" as "a" on "a"."event_id" = "e"."id" left join "codes" as "d" on "d"."code_set" = $1 and "d"."code" = "a"."reason_code" where "dn"."agency_id" = $2 and "dn"."kind" = $3 and "dn"."created_at" >= ($4::date)::timestamp at time zone $5 and "dn"."created_at" < ($6::date + 1)::timestamp at time zone $7 group by 1, 2, 3) as "r" order by "r"."denials" desc nulls last, "r"."code" desc limit $8 offset $9`
    );
    assert.deepEqual(rows.parameters, [
      'carc',
      't-1',
      'denied',
      '2026-01-01',
      'America/New_York',
      '2026-10-23',
      'America/New_York',
      100,
      0
    ]);
  });

  it('counts by code alone when grouped by reason', async () => {
    const byPayer = await compileReport(denialsReport, 'payer');
    const byReason = await compileReport(denialsReport, 'reason');
    assert.equal(
      byReason.rows.sql,
      byPayer.rows.sql.replace('coalesce(dp.name, cc.payer_name) as "payer"', 'null as "payer"')
    );
    assert.notEqual(byReason.rows.sql, byPayer.rows.sql);
  });

  it('totals only the amounts, since one denial can carry several codes', async () => {
    const { rows, totals } = await compileReport(denialsReport);
    assert.equal(
      totals.sql.replace(subquery(rows.sql), ''),
      'select coalesce(sum("r"."amount_cents"), 0)::float8 as "amount_cents"'
    );
    assert.deepEqual(totals.parameters, rows.parameters.slice(0, -2));
  });
});
