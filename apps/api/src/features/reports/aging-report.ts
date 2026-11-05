import { CLOSED_CLAIM_STATUSES } from '@ugula/billing';
import { payerName } from '@ugula/db';
import { sql } from 'kysely';
import { report } from './report.ts';
import { cents, centsWhere, count } from './report-sql.ts';

const OPEN_EXCLUDED = [...CLOSED_CLAIM_STATUSES, 'draft'] as const;

const ANSWERED = ['response', 'payer_skipped'] as const;

const AGING_BUCKETS = [
  ['days_0_30_cents', null, 30],
  ['days_31_60_cents', 31, 60],
  ['days_61_90_cents', 61, 90],
  ['days_91_120_cents', 91, 120],
  ['days_over_120_cents', 121, null]
] as const;

export const agingReport = report({
  dates: null,
  groups: ['payer', 'class'],
  rows: (db, ctx) => {
    const age = sql`(${ctx.today}::date - coalesce(c.service_date, c.created_at::date))`;
    const inBucket = (min: number | null, max: number | null) =>
      min === null
        ? sql`${age} <= ${max}`
        : max === null
          ? sql`${age} >= ${min}`
          : sql`${age} between ${min} and ${max}`;
    return db
      .selectFrom('claims as c')
      .innerJoin('claim_balances as b', 'b.claim_id', 'c.id')
      .leftJoinLateral(
        (eb) =>
          eb
            .selectFrom('claim_coverages as cc')
            .leftJoin('payers as dp', 'dp.id', 'cc.payer_id')
            .select([
              payerName.as('payer'),
              'dp.claim_filing as filing',
              sql<boolean>`cc.payer_id is not null`.as('listed')
            ])
            .whereRef('cc.claim_id', '=', 'c.id')
            .where(({ not, exists, selectFrom }) =>
              not(
                exists(
                  selectFrom('claim_events as e')
                    .select('e.id')
                    .whereRef('e.coverage_id', '=', 'cc.id')
                    .where('e.kind', 'in', ANSWERED)
                )
              )
            )
            .orderBy('cc.position')
            .limit(1)
            .as('responsible'),
        (join) => join.onTrue()
      )
      .leftJoin('facilities as f', 'f.id', 'c.facility_id')
      .select([
        (ctx.group === 'class'
          ? sql<
              string | null
            >`case when f.id is not null then 'Facility' when responsible.payer is null then null else coalesce(responsible.filing, '') end`
          : sql<string | null>`coalesce(f.name, responsible.payer)`
        ).as('name'),
        sql<boolean>`bool_and(f.id is not null or coalesce(responsible.listed, true))`.as(
          'in_directory'
        ),
        count.as('claims'),
        cents(sql.ref('b.balance_cents')).as('balance_cents'),
        ...AGING_BUCKETS.map(([key, min, max]) =>
          centsWhere(sql.ref('b.balance_cents'), inBucket(min, max)).as(key)
        )
      ])
      .where('c.agency_id', '=', ctx.agencyId)
      .where('c.status', 'not in', OPEN_EXCLUDED)
      .where('b.balance_cents', '>', 0)
      .groupBy(sql`1`)
      .as('r');
  },
  columns: [
    'name',
    'in_directory',
    'claims',
    'balance_cents',
    ...AGING_BUCKETS.map(([key]) => key)
  ],
  order: 'balance_cents',
  tiebreak: 'name',
  dir: 'desc',
  totals: ['claims', 'balance_cents', ...AGING_BUCKETS.map(([key]) => key)]
});
