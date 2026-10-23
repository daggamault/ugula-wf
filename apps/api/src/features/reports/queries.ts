import type { Database } from '@ugula/db';
import { type Kysely, sql } from 'kysely';

type Db = Kysely<Database>;

export type DateRange = { from: string; to: string };

const serviceDay = sql<string>`coalesce(c.service_date, c.created_at::date)`;

const ANSWERED = ['response', 'payer_skipped'] as const;

const sumOf = (column: string) => sql<number>`coalesce(sum(${sql.ref(column)}), 0)::int`;

const inRange = (range: DateRange) =>
  sql<boolean>`${serviceDay} between ${range.from}::date and ${range.to}::date`;

export const AGING_BUCKETS = [
  { key: 'current_cents', min: 0, max: 30 },
  { key: 'days_31_60_cents', min: 31, max: 60 },
  { key: 'days_61_90_cents', min: 61, max: 90 },
  { key: 'days_91_120_cents', min: 91, max: 120 },
  { key: 'over_120_cents', min: 121, max: null }
] as const;

export const agingReport = (db: Db, tenantId: string, asOf: string) => {
  const age = sql<number>`(${asOf}::date - ${serviceDay})`;
  const bucket = ({ min, max }: { min: number; max: number | null }) =>
    max === null
      ? sql<number>`coalesce(sum(b.balance_cents) filter (where ${age} >= ${min}), 0)::int`
      : sql<number>`coalesce(sum(b.balance_cents) filter (where ${age} between ${min} and ${max}), 0)::int`;
  return db
    .selectFrom('claims as c')
    .innerJoin('claim_balances as b', 'b.claim_id', 'c.id')
    .leftJoinLateral(
      (eb) =>
        eb
          .selectFrom('claim_coverages as cc')
          .leftJoin('payers as dp', 'dp.id', 'cc.payer_id')
          .select(sql<string>`coalesce(dp.name, cc.payer_name)`.as('payer'))
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
    .select([
      sql<string | null>`responsible.payer`.as('payer'),
      sql<number>`count(*)::int`.as('claims'),
      sumOf('b.balance_cents').as('balance_cents'),
      ...AGING_BUCKETS.map((b) => bucket(b).as(b.key))
    ])
    .where('c.tenant_id', '=', tenantId)
    .where('c.status', '=', 'open')
    .where('b.balance_cents', '>', 0)
    .groupBy(sql`responsible.payer`)
    .orderBy('balance_cents', 'desc')
    .execute();
};

export const monthlyReport = (db: Db, tenantId: string, range: DateRange) =>
  db
    .selectFrom('claims as c')
    .innerJoin('claim_balances as b', 'b.claim_id', 'c.id')
    .select([
      sql<string>`to_char(date_trunc('month', ${serviceDay}), 'YYYY-MM')`.as('month'),
      sql<number>`count(*)::int`.as('claims'),
      sumOf('c.total_cents').as('charges_cents'),
      sumOf('b.paid_cents').as('paid_cents'),
      sumOf('b.adjusted_cents').as('adjusted_cents'),
      sql<number>`coalesce(sum(b.balance_cents) filter (where c.status = 'open'), 0)::int`.as(
        'open_balance_cents'
      ),
      sql<number>`coalesce(sum(b.balance_cents) filter (where c.status in ('written_off', 'collections')), 0)::int`.as(
        'unrecovered_cents'
      )
    ])
    .where('c.tenant_id', '=', tenantId)
    .where(inRange(range))
    .groupBy(sql`1`)
    .orderBy('month', 'desc')
    .execute();

export const hcpcsReport = (db: Db, tenantId: string, range: DateRange) =>
  db
    .selectFrom('claim_lines as l')
    .innerJoin('claims as c', 'c.id', 'l.claim_id')
    .select([
      'l.code',
      sql<number>`count(distinct l.claim_id)::int`.as('claims'),
      sql<string>`sum(l.units)`.as('units'),
      sumOf('l.total_cents').as('charges_cents'),
      sql<number>`round(avg(l.unit_cents))::int`.as('average_unit_cents')
    ])
    .where('c.tenant_id', '=', tenantId)
    .where(inRange(range))
    .groupBy('l.code')
    .orderBy('charges_cents', 'desc')
    .execute();

export const payerReport = (db: Db, tenantId: string, range: DateRange) =>
  db
    .selectFrom('claim_coverages as cc')
    .innerJoin('claims as c', 'c.id', 'cc.claim_id')
    .leftJoin('payers as dp', 'dp.id', 'cc.payer_id')
    .leftJoinLateral(
      (eb) =>
        eb
          .selectFrom('claim_events as e')
          .select([
            sql<Date | null>`min(e.created_at) filter (where e.kind in ('submitted', 'resubmitted'))`.as(
              'first_submitted'
            ),
            sql<Date | null>`min(e.created_at) filter (where e.kind = 'response')`.as(
              'first_response'
            ),
            sumOf('e.paid_cents').as('paid_cents'),
            sumOf('e.adjusted_cents').as('adjusted_cents')
          ])
          .whereRef('e.coverage_id', '=', 'cc.id')
          .as('activity'),
      (join) => join.onTrue()
    )
    .select([
      sql<string>`coalesce(dp.name, cc.payer_name)`.as('payer'),
      sql<boolean>`bool_and(cc.payer_id is not null)`.as('in_directory'),
      sql<number>`count(*)::int`.as('claims'),
      sql<number>`(count(*) filter (where activity.first_submitted is not null))::int`.as(
        'submitted'
      ),
      sql<number>`(count(*) filter (where activity.first_response is not null))::int`.as(
        'answered'
      ),
      sumOf('activity.paid_cents').as('paid_cents'),
      sumOf('activity.adjusted_cents').as('adjusted_cents'),
      sql<
        number | null
      >`round(avg(extract(epoch from activity.first_response - activity.first_submitted) / 86400) filter (where activity.first_response > activity.first_submitted), 1)::float`.as(
        'average_days_to_response'
      )
    ])
    .where('c.tenant_id', '=', tenantId)
    .where(inRange(range))
    .groupBy(sql`1`)
    .orderBy('paid_cents', 'desc')
    .execute();

export const patientPayments = async (db: Db, tenantId: string, range: DateRange) =>
  await db
    .selectFrom('claim_events as e')
    .innerJoin('claims as c', 'c.id', 'e.claim_id')
    .select([
      sumOf('e.paid_cents').as('paid_cents'),
      sumOf('e.adjusted_cents').as('adjusted_cents')
    ])
    .where('c.tenant_id', '=', tenantId)
    .where('e.kind', '=', 'response')
    .where('e.coverage_id', 'is', null)
    .where(inRange(range))
    .executeTakeFirstOrThrow();
