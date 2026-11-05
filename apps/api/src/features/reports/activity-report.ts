import { type Expression, sql } from 'kysely';
import { report } from './report.ts';
import { cents, SUBMISSIONS, UNRECOVERED, within, zero } from './report-sql.ts';

const monthOf = (at: Expression<unknown>, tz: string) =>
  sql<string>`to_char(${at} at time zone ${tz}, 'YYYY-MM')`;

export const activityReport = report({
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
      .where('c.agency_id', '=', ctx.agencyId)
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
      .where('c.agency_id', '=', ctx.agencyId)
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
      .where('c.agency_id', '=', ctx.agencyId)
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
  columns: [
    'month',
    'claims_billed',
    'charges_billed_cents',
    'payer_paid_cents',
    'patient_paid_cents',
    'adjusted_cents',
    'written_off_cents',
    'collections_cents'
  ],
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
