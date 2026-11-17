import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { agingReport } from './aging-report.ts';
import { compileReport } from './testing.ts';

const BUCKETS = [
  'days_0_30_cents',
  'days_31_60_cents',
  'days_61_90_cents',
  'days_91_120_cents',
  'days_over_120_cents'
];

const AGE = (n: number) => `($${n}::date - coalesce(c.service_date, c.created_at::date))`;

const IN = (key: string, where: string) =>
  `coalesce(sum("b"."balance_cents") filter (where ${where}), 0)::float8 as "${key}"`;

const ROWS = (name: string) =>
  `select ${name} as "name", bool_and(f.id is not null or coalesce(responsible.listed, true)) as "in_directory", count(*)::int as "claims", coalesce(sum("b"."balance_cents"), 0)::float8 as "balance_cents", ${IN('days_0_30_cents', `${AGE(1)} <= $2`)}, ${IN('days_31_60_cents', `${AGE(3)} between $4 and $5`)}, ${IN('days_61_90_cents', `${AGE(6)} between $7 and $8`)}, ${IN('days_91_120_cents', `${AGE(9)} between $10 and $11`)}, ${IN('days_over_120_cents', `${AGE(12)} >= $13`)} from "claims" as "c" inner join "claim_balances" as "b" on "b"."claim_id" = "c"."id" left join lateral (select coalesce(dp.name, cc.payer_name) as "payer", "dp"."claim_filing" as "filing", cc.payer_id is not null as "listed" from "claim_coverages" as "cc" left join "payers" as "dp" on "dp"."id" = "cc"."payer_id" where "cc"."claim_id" = "c"."id" and not exists (select "e"."id" from "claim_events" as "e" where "e"."coverage_id" = "cc"."id" and "e"."kind" in ($14, $15)) order by "cc"."position" limit $16) as "responsible" on true left join "facilities" as "f" on "f"."id" = "c"."facility_id" where "c"."agency_id" = $17 and "c"."status" not in ($18, $19, $20, $21, $22) and "b"."balance_cents" > $23 group by 1`;

const COLUMNS = ['name', 'in_directory', 'claims', 'balance_cents', ...BUCKETS]
  .map((c) => `"r"."${c}" as "${c}"`)
  .join(', ');

const PARAMETERS = [
  ...['2026-10-23', 30, '2026-10-23', 31, 60, '2026-10-23', 61, 90],
  ...['2026-10-23', 91, 120, '2026-10-23', 121],
  ...['response', 'payer_skipped', 1, 't-1'],
  ...['paid', 'written_off', 'collections', 'void', 'draft', 0]
];

const PAYER_NAME = 'coalesce(f.name, responsible.payer)';

describe('agingReport', () => {
  it('is an undated report grouped by payer or payer class', () => {
    assert.deepEqual(
      { dates: agingReport.dates, groups: agingReport.groups },
      { dates: null, groups: ['payer', 'class'] }
    );
  });

  it('ages open agency balances from the date of service by the first payer yet to answer', async () => {
    const { rows } = await compileReport(agingReport, 'payer');
    assert.equal(
      rows.sql,
      `select ${COLUMNS}, count(*) over () as "total" from (${ROWS(PAYER_NAME)}) as "r" order by "r"."balance_cents" desc nulls last, "r"."name" desc limit $24 offset $25`
    );
    assert.deepEqual(rows.parameters, [...PARAMETERS, 100, 0]);
  });

  it('names payer classes, counting facility claims as Facility', async () => {
    const { rows } = await compileReport(agingReport, 'class');
    assert.equal(
      rows.sql,
      `select ${COLUMNS}, count(*) over () as "total" from (${ROWS(
        `case when f.id is not null then 'Facility' when responsible.payer is null then null else coalesce(responsible.filing, '') end`
      )}) as "r" order by "r"."balance_cents" desc nulls last, "r"."name" desc limit $24 offset $25`
    );
  });

  it('totals the claims, the balance and every bucket', async () => {
    const { totals } = await compileReport(agingReport);
    assert.equal(
      totals.sql,
      `select ${['claims', 'balance_cents', ...BUCKETS]
        .map((c) => `coalesce(sum("r"."${c}"), 0)::float8 as "${c}"`)
        .join(', ')} from (${ROWS(PAYER_NAME)}) as "r"`
    );
    assert.deepEqual(totals.parameters, PARAMETERS);
  });
});
