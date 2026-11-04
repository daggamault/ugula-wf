import { CLOSED_CLAIM_STATUSES } from '@ugula/billing';
import { type Db, payerName } from '@ugula/db';
import { type AliasedExpression, type Expression, sql } from 'kysely';
import { type Page, paged, type SortDir } from '../../shared/paging.ts';
import type { ReportPage } from './schemas.ts';

export type DateRange = { from: string; to: string };

type DateKind = 'service' | 'posted' | 'completed' | 'received';

export type ReportContext = {
  tenantId: string;
  tz: string;
  now: string;
  today: string;
  range: DateRange;
  group: string;
};

type ReportResult = Page<unknown> & { totals: Record<string, number> };

type ReportSpec<R> = {
  dates: DateKind | null;
  groups?: readonly [string, ...string[]];
  rows: (db: Db, ctx: ReportContext) => AliasedExpression<R, 'r'>;
  order: keyof R & string;
  tiebreak: keyof R & string;
  dir: SortDir;
  totals: readonly (keyof R & string)[];
};

type Report = {
  dates: DateKind | null;
  groups: readonly string[] | null;
  run: (db: Db, ctx: ReportContext, page: ReportPage) => Promise<ReportResult>;
};

const REPORT_PAGE_SIZE = 100;

const UNBILLED = ['draft', 'void'] as const;

const OPEN_EXCLUDED = [...CLOSED_CLAIM_STATUSES, 'draft'] as const;

const PRE_SUBMISSION = ['draft', 'needs_review', 'ready'] as const;

const SUBMISSIONS = ['submitted', 'resubmitted'] as const;

const ANSWERED = ['response', 'payer_skipped'] as const;

const UNRECOVERED = ['written_off', 'collections'] as const;

const PAYMENTS = ['response', 'refunded'] as const;

const closedList = sql.join(CLOSED_CLAIM_STATUSES.map((s) => sql.lit(s)));

const cents = (expr: Expression<unknown>) => sql<number>`coalesce(sum(${expr}), 0)::float8`;

const centsWhere = (expr: Expression<unknown>, where: Expression<unknown>) =>
  sql<number>`coalesce(sum(${expr}) filter (where ${where}), 0)::float8`;

const countWhere = (where: Expression<unknown>) =>
  sql<number>`(count(*) filter (where ${where}))::int`;

const count = sql<number>`count(*)::int`;

const zero = sql<number>`0`;

const startOf = (day: string, tz: string) => sql`(${day}::date)::timestamp at time zone ${tz}`;

const within = (at: Expression<unknown>, { range, tz }: ReportContext) =>
  sql<boolean>`${at} >= ${startOf(range.from, tz)} and ${at} < (${range.to}::date + 1)::timestamp at time zone ${tz}`;

const monthOf = (at: Expression<unknown>, tz: string) =>
  sql<string>`to_char(${at} at time zone ${tz}, 'YYYY-MM')`;

const servedIn = ({ range }: ReportContext) =>
  sql<boolean>`c.service_date between ${range.from}::date and ${range.to}::date`;

const balance = sql`c.total_cents - x.payer_paid - x.patient_paid - x.adjusted`;

const reasonCode = sql<string>`a.group_code || '-' || a.reason_code`;

const hasReasons = sql<boolean>`exists (select 1 from claim_event_adjustments a where a.event_id = e.id)`;

const report = <R>(spec: ReportSpec<R>): Report => ({
  dates: spec.dates,
  groups: spec.groups ?? null,
  run: async (db, ctx, page) => {
    const order = sql.ref(`r.${spec.order}`);
    const tiebreak = sql.ref(`r.${spec.tiebreak}`);
    const rows = db.selectFrom(spec.rows(db, ctx)).selectAll();
    const [listed, totals] = await Promise.all([
      page === 'all'
        ? rows
            .orderBy(sql`${order} ${sql.raw(spec.dir)} nulls last`)
            .orderBy(sql`${tiebreak} ${sql.raw(spec.dir)}`)
            .execute()
            .then((items) => ({ items, total: items.length, page: 1, pageSize: items.length }))
        : paged(
            rows,
            { page, pageSize: REPORT_PAGE_SIZE, sort: 'order', dir: spec.dir },
            { order },
            tiebreak
          ),
      spec.totals.length
        ? db
            .selectFrom(spec.rows(db, ctx))
            .select(spec.totals.map((k) => cents(sql.ref(`r.${k}`)).as(k)))
            .executeTakeFirstOrThrow()
        : {}
    ]);
    return { ...listed, totals: totals as Record<string, number> };
  }
});

const AGING_BUCKETS = [
  ['days_0_30_cents', null, 30],
  ['days_31_60_cents', 31, 60],
  ['days_61_90_cents', 61, 90],
  ['days_91_120_cents', 91, 120],
  ['days_over_120_cents', 121, null]
] as const;

const aging = report({
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
      .select([
        (ctx.group === 'class'
          ? sql<
              string | null
            >`case when responsible.payer is null then null else coalesce(responsible.filing, '') end`
          : sql<string | null>`responsible.payer`
        ).as('name'),
        sql<boolean>`bool_and(coalesce(responsible.listed, true))`.as('in_directory'),
        count.as('claims'),
        cents(sql.ref('b.balance_cents')).as('balance_cents'),
        ...AGING_BUCKETS.map(([key, min, max]) =>
          centsWhere(sql.ref('b.balance_cents'), inBucket(min, max)).as(key)
        )
      ])
      .where('c.tenant_id', '=', ctx.tenantId)
      .where('c.status', 'not in', OPEN_EXCLUDED)
      .where('b.balance_cents', '>', 0)
      .groupBy(sql`1`)
      .as('r');
  },
  order: 'balance_cents',
  tiebreak: 'name',
  dir: 'desc',
  totals: ['claims', 'balance_cents', ...AGING_BUCKETS.map(([key]) => key)]
});

const monthly = report({
  dates: 'service',
  rows: (db, ctx) =>
    db
      .selectFrom('claims as c')
      .innerJoinLateral(
        (eb) =>
          eb
            .selectFrom('claim_events as e')
            .select([
              centsWhere(sql.ref('e.paid_cents'), sql`e.coverage_id is not null`).as('payer_paid'),
              centsWhere(sql.ref('e.paid_cents'), sql`e.coverage_id is null`).as('patient_paid'),
              cents(sql.ref('e.adjusted_cents')).as('adjusted'),
              sql<Date | null>`min(e.created_at) filter (where e.kind in ('submitted', 'resubmitted'))`.as(
                'first_submitted'
              )
            ])
            .whereRef('e.claim_id', '=', 'c.id')
            .as('x'),
        (join) => join.onTrue()
      )
      .select([
        sql<string>`to_char(c.service_date, 'YYYY-MM')`.as('month'),
        count.as('claims'),
        cents(sql.ref('c.total_cents')).as('charges_cents'),
        cents(sql.ref('x.payer_paid')).as('payer_paid_cents'),
        cents(sql.ref('x.patient_paid')).as('patient_paid_cents'),
        cents(sql.ref('x.adjusted')).as('adjusted_cents'),
        centsWhere(balance, sql`c.status = 'written_off'`).as('written_off_cents'),
        centsWhere(balance, sql`c.status = 'collections'`).as('collections_cents'),
        centsWhere(balance, sql`c.status not in (${closedList})`).as('open_balance_cents'),
        countWhere(sql`x.first_submitted is not null`).as('billed'),
        cents(sql`(x.first_submitted at time zone ${ctx.tz})::date - c.service_date`).as(
          'bill_days'
        )
      ])
      .where('c.tenant_id', '=', ctx.tenantId)
      .where('c.status', 'not in', UNBILLED)
      .where(servedIn(ctx))
      .groupBy(sql`1`)
      .as('r'),
  order: 'month',
  tiebreak: 'month',
  dir: 'asc',
  totals: [
    'claims',
    'charges_cents',
    'payer_paid_cents',
    'patient_paid_cents',
    'adjusted_cents',
    'written_off_cents',
    'collections_cents',
    'open_balance_cents',
    'billed',
    'bill_days'
  ]
});

const payers = report({
  dates: 'service',
  groups: ['payer', 'class'],
  rows: (db, ctx) => {
    const coverages = db
      .selectFrom('claim_coverages as cc')
      .innerJoin('claims as c', 'c.id', 'cc.claim_id')
      .leftJoin('payers as dp', 'dp.id', 'cc.payer_id')
      .innerJoinLateral(
        (eb) =>
          eb
            .selectFrom('claim_events as e')
            .select([
              sql<Date | null>`min(e.created_at) filter (where e.kind in ('submitted', 'resubmitted'))`.as(
                'first_submitted'
              ),
              sql<Date | null>`min(e.created_at) filter (where e.kind = 'response' and e.paid_cents > 0)`.as(
                'first_paid'
              ),
              countWhere(sql`e.kind = 'response'`).as('responses'),
              countWhere(sql`e.kind = 'response' and e.paid_cents = 0 and ${hasReasons}`).as(
                'denials'
              ),
              cents(sql.ref('e.paid_cents')).as('paid'),
              cents(sql.ref('e.adjusted_cents')).as('adjusted')
            ])
            .whereRef('e.coverage_id', '=', 'cc.id')
            .as('a'),
        (join) => join.onTrue()
      )
      .select([
        (ctx.group === 'class'
          ? sql<string | null>`coalesce(dp.claim_filing, '')`
          : sql<string | null>`${payerName}`
        ).as('name'),
        sql<boolean>`bool_and(cc.payer_id is not null)`.as('in_directory'),
        count.as('billed'),
        cents(sql.ref('c.total_cents')).as('charges_cents'),
        cents(sql.ref('a.paid')).as('paid_cents'),
        cents(sql.ref('a.adjusted')).as('adjusted_cents'),
        sql<number>`sum(a.responses)::int`.as('responses'),
        sql<number>`sum(a.denials)::int`.as('denials'),
        countWhere(sql`a.first_paid >= a.first_submitted`).as('paid_claims'),
        centsWhere(
          sql`extract(epoch from a.first_paid - a.first_submitted) / 86400`,
          sql`a.first_paid >= a.first_submitted`
        ).as('pay_days')
      ])
      .where('c.tenant_id', '=', ctx.tenantId)
      .where('c.status', 'not in', UNBILLED)
      .where(servedIn(ctx))
      .where(sql<boolean>`a.first_submitted is not null or a.responses > 0`)
      .groupBy(sql`1`);
    const patient = db
      .selectFrom('claim_events as e')
      .innerJoin('claims as c', 'c.id', 'e.claim_id')
      .select([
        sql<string | null>`null`.as('name'),
        sql<boolean>`true`.as('in_directory'),
        zero.as('billed'),
        zero.as('charges_cents'),
        cents(sql.ref('e.paid_cents')).as('paid_cents'),
        cents(sql.ref('e.adjusted_cents')).as('adjusted_cents'),
        zero.as('responses'),
        zero.as('denials'),
        zero.as('paid_claims'),
        zero.as('pay_days')
      ])
      .where('c.tenant_id', '=', ctx.tenantId)
      .where('e.kind', '=', 'response')
      .where('e.coverage_id', 'is', null)
      .where('c.status', 'not in', UNBILLED)
      .where(servedIn(ctx))
      .having(sql<boolean>`count(*) > 0`);
    return coverages.unionAll(patient).as('r');
  },
  order: 'paid_cents',
  tiebreak: 'name',
  dir: 'desc',
  totals: [
    'billed',
    'charges_cents',
    'paid_cents',
    'adjusted_cents',
    'responses',
    'denials',
    'paid_claims',
    'pay_days'
  ]
});

const hcpcs = report({
  dates: 'service',
  rows: (db, ctx) =>
    db
      .selectFrom('claim_lines as l')
      .innerJoin('claims as c', 'c.id', 'l.claim_id')
      .select([
        'l.code',
        sql<number>`count(distinct l.claim_id)::int`.as('claims'),
        sql<number>`sum(l.units)::float8`.as('units'),
        cents(sql.ref('l.total_cents')).as('charges_cents')
      ])
      .where('c.tenant_id', '=', ctx.tenantId)
      .where('c.status', 'not in', UNBILLED)
      .where(servedIn(ctx))
      .groupBy('l.code')
      .as('r'),
  order: 'charges_cents',
  tiebreak: 'code',
  dir: 'desc',
  totals: ['charges_cents']
});

const levels = report({
  dates: 'service',
  rows: (db, ctx) =>
    db
      .selectFrom('claims as c')
      .select([
        'c.level',
        'c.emergency',
        count.as('trips'),
        sql<number>`coalesce(sum(c.loaded_miles), 0)::float8`.as('miles'),
        cents(sql.ref('c.total_cents')).as('charges_cents')
      ])
      .where('c.tenant_id', '=', ctx.tenantId)
      .where('c.status', 'not in', UNBILLED)
      .where(servedIn(ctx))
      .groupBy(['c.level', 'c.emergency'])
      .as('r'),
  order: 'charges_cents',
  tiebreak: 'level',
  dir: 'desc',
  totals: ['trips', 'miles', 'charges_cents']
});

const payments = report({
  dates: 'posted',
  rows: (db, ctx) =>
    db
      .selectFrom('claim_events as e')
      .innerJoin('claims as c', 'c.id', 'e.claim_id')
      .leftJoin('patients as p', 'p.id', 'c.patient_id')
      .leftJoin('claim_coverages as cc', 'cc.id', 'e.coverage_id')
      .leftJoin('payers as dp', 'dp.id', 'cc.payer_id')
      .leftJoin('users as u', 'u.id', 'e.created_by')
      .select([
        'e.id',
        'e.created_at as posted_at',
        'c.number as claim_number',
        'c.pcr_number',
        'p.first_name',
        'p.last_name',
        'c.service_date',
        sql<string | null>`case when cc.id is null then null else ${payerName} end`.as('payer'),
        'dp.claim_filing as filing',
        'e.kind',
        'e.paid_on',
        'e.check_number',
        'e.payer_claim_number',
        'e.paid_cents',
        'e.adjusted_cents',
        sql<string>`array_to_string(array(${db
          .selectFrom('claim_event_adjustments as a')
          .select(reasonCode.as('code'))
          .where('a.event_id', '=', sql.ref<string>('e.id'))
          .orderBy('a.position')}), ', ')`.as('reason_codes'),
        'u.email as posted_by',
        'e.note'
      ])
      .where('c.tenant_id', '=', ctx.tenantId)
      .where('e.kind', 'in', PAYMENTS)
      .where(within(sql.ref('e.created_at'), ctx))
      .as('r'),
  order: 'posted_at',
  tiebreak: 'id',
  dir: 'asc',
  totals: ['paid_cents', 'adjusted_cents']
});

const denials = report({
  dates: 'posted',
  groups: ['payer', 'reason'],
  rows: (db, ctx) =>
    db
      .selectFrom('claim_event_adjustments as a')
      .innerJoin('claim_events as e', 'e.id', 'a.event_id')
      .innerJoin('claims as c', 'c.id', 'e.claim_id')
      .leftJoin('claim_coverages as cc', 'cc.id', 'e.coverage_id')
      .leftJoin('payers as dp', 'dp.id', 'cc.payer_id')
      .select([
        (ctx.group === 'reason'
          ? sql<string | null>`null`
          : sql<string | null>`case when cc.id is null then null else ${payerName} end`
        ).as('payer'),
        reasonCode.as('code'),
        count.as('adjustments'),
        sql<number>`(count(distinct e.id) filter (where e.paid_cents = 0))::int`.as('denials'),
        sql<number>`count(distinct e.claim_id)::int`.as('claims'),
        cents(sql.ref('a.amount_cents')).as('amount_cents')
      ])
      .where('c.tenant_id', '=', ctx.tenantId)
      .where('e.kind', '=', 'response')
      .where(within(sql.ref('e.created_at'), ctx))
      .groupBy([sql`1`, sql`2`])
      .as('r'),
  order: 'amount_cents',
  tiebreak: 'code',
  dir: 'desc',
  totals: ['adjustments', 'denials', 'amount_cents']
});

const activity = report({
  dates: 'posted',
  rows: (db, ctx) => {
    const month = (at: Expression<unknown>) => monthOf(at, ctx.tz).as('month');
    const billed = db
      .selectFrom('claim_events as e')
      .innerJoin('claims as c', 'c.id', 'e.claim_id')
      .select([
        month(sql.ref('e.created_at')),
        sql<number>`1`.as('claims_billed'),
        sql<number>`c.total_cents`.as('charges_billed'),
        zero.as('payer_paid'),
        zero.as('patient_paid'),
        zero.as('adjusted'),
        zero.as('written_off'),
        zero.as('collections')
      ])
      .where('c.tenant_id', '=', ctx.tenantId)
      .where('e.kind', 'in', SUBMISSIONS)
      .where(within(sql.ref('e.created_at'), ctx))
      .where(({ not, exists, selectFrom }) =>
        not(
          exists(
            selectFrom('claim_events as f')
              .select('f.id')
              .whereRef('f.claim_id', '=', 'e.claim_id')
              .where('f.kind', 'in', SUBMISSIONS)
              .where(sql<boolean>`(f.created_at, f.id) < (e.created_at, e.id)`)
          )
        )
      );
    const posted = db
      .selectFrom('claim_events as e')
      .innerJoin('claims as c', 'c.id', 'e.claim_id')
      .select([
        month(sql.ref('e.created_at')),
        zero.as('claims_billed'),
        zero.as('charges_billed'),
        sql<number>`case when e.coverage_id is null then 0 else e.paid_cents end`.as('payer_paid'),
        sql<number>`case when e.coverage_id is null then e.paid_cents else 0 end`.as(
          'patient_paid'
        ),
        sql<number>`e.adjusted_cents`.as('adjusted'),
        zero.as('written_off'),
        zero.as('collections')
      ])
      .where('c.tenant_id', '=', ctx.tenantId)
      .where('e.kind', '=', 'response')
      .where(within(sql.ref('e.created_at'), ctx));
    const closed = db
      .selectFrom('claim_events as e')
      .innerJoin('claims as c', 'c.id', 'e.claim_id')
      .innerJoin('claim_balances as b', 'b.claim_id', 'c.id')
      .select([
        month(sql.ref('e.created_at')),
        zero.as('claims_billed'),
        zero.as('charges_billed'),
        zero.as('payer_paid'),
        zero.as('patient_paid'),
        zero.as('adjusted'),
        sql<number>`case when e.note = 'written_off' then b.balance_cents else 0 end`.as(
          'written_off'
        ),
        sql<number>`case when e.note = 'collections' then b.balance_cents else 0 end`.as(
          'collections'
        )
      ])
      .where('c.tenant_id', '=', ctx.tenantId)
      .where('e.kind', '=', 'closed')
      .where('e.note', 'in', UNRECOVERED)
      .where(within(sql.ref('e.created_at'), ctx));
    return db
      .selectFrom(billed.unionAll(posted).unionAll(closed).as('f'))
      .select([
        'f.month',
        cents(sql.ref('f.claims_billed')).as('claims_billed'),
        cents(sql.ref('f.charges_billed')).as('charges_billed_cents'),
        cents(sql.ref('f.payer_paid')).as('payer_paid_cents'),
        cents(sql.ref('f.patient_paid')).as('patient_paid_cents'),
        cents(sql.ref('f.adjusted')).as('adjusted_cents'),
        cents(sql.ref('f.written_off')).as('written_off_cents'),
        cents(sql.ref('f.collections')).as('collections_cents')
      ])
      .groupBy('f.month')
      .as('r');
  },
  order: 'month',
  tiebreak: 'month',
  dir: 'asc',
  totals: [
    'claims_billed',
    'charges_billed_cents',
    'payer_paid_cents',
    'patient_paid_cents',
    'adjusted_cents',
    'written_off_cents',
    'collections_cents'
  ]
});

const unbilled = report({
  dates: null,
  rows: (db, ctx) =>
    db
      .selectFrom('claims as c')
      .leftJoin('patients as p', 'p.id', 'c.patient_id')
      .leftJoinLateral(
        (eb) =>
          eb
            .selectFrom('claim_runs as cr')
            .innerJoin('tasks as t', 't.run_id', 'cr.run_id')
            .select('t.queue')
            .whereRef('cr.claim_id', '=', 'c.id')
            .where('t.status', '=', 'open')
            .orderBy('t.created_at')
            .limit(1)
            .as('t'),
        (join) => join.onTrue()
      )
      .select([
        'c.number as claim_number',
        'c.pcr_number',
        'p.first_name',
        'p.last_name',
        'c.service_date',
        'c.status',
        't.queue',
        sql<number>`${ctx.today}::date - coalesce(c.service_date, (c.created_at at time zone ${ctx.tz})::date)`.as(
          'age_days'
        ),
        'c.total_cents as charges_cents'
      ])
      .where('c.tenant_id', '=', ctx.tenantId)
      .where('c.status', 'in', PRE_SUBMISSION)
      .as('r'),
  order: 'age_days',
  tiebreak: 'claim_number',
  dir: 'desc',
  totals: ['charges_cents']
});

const writeOffs = report({
  dates: 'posted',
  rows: (db, ctx) =>
    db
      .selectFrom('claim_events as e')
      .innerJoin('claims as c', 'c.id', 'e.claim_id')
      .innerJoin('claim_balances as b', 'b.claim_id', 'c.id')
      .leftJoin('patients as p', 'p.id', 'c.patient_id')
      .select([
        'e.id',
        'e.created_at as closed_at',
        'c.number as claim_number',
        'c.pcr_number',
        'p.first_name',
        'p.last_name',
        'c.service_date',
        'e.note as outcome',
        'c.total_cents as charges_cents',
        'b.paid_cents',
        'b.adjusted_cents',
        'b.balance_cents'
      ])
      .where('c.tenant_id', '=', ctx.tenantId)
      .where('e.kind', '=', 'closed')
      .where('e.note', 'in', UNRECOVERED)
      .where(within(sql.ref('e.created_at'), ctx))
      .as('r'),
  order: 'closed_at',
  tiebreak: 'id',
  dir: 'asc',
  totals: ['charges_cents', 'paid_cents', 'adjusted_cents', 'balance_cents']
});

const TASK_AGES = [
  ['days_0_1', null, 1],
  ['days_2_7', 2, 7],
  ['days_8_30', 8, 30],
  ['days_over_30', 31, null]
] as const;

const workQueue = report({
  dates: null,
  groups: ['queue', 'assignee'],
  rows: (db, ctx) => {
    const age = sql`floor(extract(epoch from ${ctx.now}::timestamptz - t.created_at) / 86400)`;
    return db
      .selectFrom('tasks as t')
      .leftJoin('users as u', 'u.id', 't.assignee_id')
      .select([
        (ctx.group === 'assignee' ? sql<string | null>`u.email` : sql<string | null>`t.queue`).as(
          'name'
        ),
        count.as('open'),
        countWhere(sql`t.assignee_id is null`).as('unassigned'),
        ...TASK_AGES.map(([key, min, max]) =>
          countWhere(
            min === null
              ? sql`${age} <= ${max}`
              : max === null
                ? sql`${age} >= ${min}`
                : sql`${age} between ${min} and ${max}`
          ).as(key)
        ),
        sql<Date>`min(t.created_at)`.as('oldest_at')
      ])
      .where('t.tenant_id', '=', ctx.tenantId)
      .where('t.status', '=', 'open')
      .groupBy(sql`1`)
      .as('r');
  },
  order: 'open',
  tiebreak: 'name',
  dir: 'desc',
  totals: ['open', 'unassigned', ...TASK_AGES.map(([key]) => key)]
});

const productivity = report({
  dates: 'completed',
  rows: (db, ctx) => {
    const tasks = db
      .selectFrom('tasks as t')
      .select([
        sql<string>`t.completed_by`.as('user_id'),
        sql<number>`1`.as('tasks'),
        sql<number>`extract(epoch from t.completed_at - t.created_at) / 3600`.as('task_hours'),
        zero.as('submitted'),
        zero.as('posted')
      ])
      .where('t.tenant_id', '=', ctx.tenantId)
      .where('t.status', '=', 'completed')
      .where('t.completed_by', 'is not', null)
      .where(within(sql.ref('t.completed_at'), ctx));
    const events = db
      .selectFrom('claim_events as e')
      .innerJoin('claims as c', 'c.id', 'e.claim_id')
      .select([
        sql<string>`e.created_by`.as('user_id'),
        zero.as('tasks'),
        zero.as('task_hours'),
        sql<number>`(e.kind <> 'response')::int`.as('submitted'),
        sql<number>`(e.kind = 'response')::int`.as('posted')
      ])
      .where('c.tenant_id', '=', ctx.tenantId)
      .where('e.kind', 'in', [...SUBMISSIONS, 'response'])
      .where('e.created_by', 'is not', null)
      .where(within(sql.ref('e.created_at'), ctx));
    return db
      .selectFrom(tasks.unionAll(events).as('f'))
      .innerJoin('users as u', 'u.id', 'f.user_id')
      .select([
        'u.email as name',
        cents(sql.ref('f.tasks')).as('tasks'),
        cents(sql.ref('f.task_hours')).as('task_hours'),
        cents(sql.ref('f.submitted')).as('submitted'),
        cents(sql.ref('f.posted')).as('posted')
      ])
      .groupBy('u.email')
      .as('r');
  },
  order: 'tasks',
  tiebreak: 'name',
  dir: 'desc',
  totals: ['tasks', 'task_hours', 'submitted', 'posted']
});

const imports = report({
  dates: 'received',
  rows: (db, ctx) =>
    db
      .selectFrom('imports as i')
      .innerJoinLateral(
        (eb) =>
          eb
            .selectFrom('import_reports as ir')
            .leftJoin('claims as c', 'c.import_report_id', 'ir.id')
            .select([
              count.as('pcrs'),
              countWhere(sql`c.status not in ('draft', 'void')`).as('billed'),
              countWhere(sql`c.status = 'draft'`).as('drafts'),
              countWhere(sql`c.status = 'void'`).as('voided'),
              countWhere(
                sql`c.id is null and exists (select 1 from claims o where o.tenant_id = i.tenant_id and o.pcr_number = ir.pcr_number)`
              ).as('revisions'),
              countWhere(
                sql`c.id is null and not exists (select 1 from claims o where o.tenant_id = i.tenant_id and o.pcr_number = ir.pcr_number)`
              ).as('no_claim'),
              centsWhere(sql.ref('c.total_cents'), sql`c.status not in ('draft', 'void')`).as(
                'charges'
              )
            ])
            .whereRef('ir.import_id', '=', 'i.id')
            .as('x'),
        (join) => join.onTrue()
      )
      .innerJoinLateral(
        (eb) =>
          eb
            .selectFrom('workflow_runs as ch')
            .select(countWhere(sql`ch.status in ('faulted', 'failed')`).as('failed'))
            .whereRef('ch.parent_id', '=', 'i.run_id')
            .as('runs'),
        (join) => join.onTrue()
      )
      .select([
        'i.id',
        'i.created_at as received_at',
        'i.file_name',
        'i.source',
        sql<number>`coalesce(i.report_count, x.pcrs)`.as('pcrs'),
        'x.billed',
        'x.drafts',
        'x.voided',
        'x.revisions',
        'x.no_claim',
        'runs.failed',
        'x.charges as charges_cents'
      ])
      .where('i.tenant_id', '=', ctx.tenantId)
      .where(within(sql.ref('i.created_at'), ctx))
      .as('r'),
  order: 'received_at',
  tiebreak: 'id',
  dir: 'asc',
  totals: ['pcrs', 'billed', 'drafts', 'voided', 'revisions', 'no_claim', 'failed', 'charges_cents']
});

export const REPORTS = {
  aging,
  unbilled,
  monthly,
  activity,
  payments,
  denials,
  'write-offs': writeOffs,
  payers,
  hcpcs,
  levels,
  'work-queue': workQueue,
  productivity,
  imports
} as const satisfies Record<string, Report>;

type ReportId = keyof typeof REPORTS;

export const findReport = (id: string): Report | undefined =>
  Object.hasOwn(REPORTS, id) ? REPORTS[id as ReportId] : undefined;
