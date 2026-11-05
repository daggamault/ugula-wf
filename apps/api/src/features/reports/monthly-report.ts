import { CLOSED_CLAIM_STATUSES } from '@ugula/billing';
import { sql } from 'kysely';
import { report } from './report.ts';
import { cents, centsWhere, count, countWhere, servedIn, UNBILLED } from './report-sql.ts';

const closedList = sql.join(CLOSED_CLAIM_STATUSES.map((s) => sql.lit(s)));

const balance = sql`c.total_cents - x.payer_paid - x.patient_paid - x.adjusted`;

export const monthlyReport = report({
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
      .where('c.agency_id', '=', ctx.agencyId)
      .where('c.status', 'not in', UNBILLED)
      .where(servedIn(ctx))
      .groupBy(sql`1`)
      .as('r'),
  columns: [
    'month',
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
  ],
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
