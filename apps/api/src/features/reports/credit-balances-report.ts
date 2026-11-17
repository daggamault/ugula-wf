import { sql } from 'kysely';
import { report } from './report.ts';

export const creditBalancesReport = report({
  dates: null,
  rows: (db, ctx) =>
    db
      .selectFrom('claims as c')
      .innerJoin('claim_balances as b', 'b.claim_id', 'c.id')
      .leftJoin('patients as p', 'p.id', 'c.patient_id')
      .innerJoinLateral(
        (eb) =>
          eb
            .selectFrom('claim_events as e')
            .select(sql<Date | null>`max(e.created_at)`.as('at'))
            .whereRef('e.claim_id', '=', 'c.id')
            .where('e.kind', '=', 'response')
            .where('e.paid_cents', '>', 0)
            .as('paid'),
        (join) => join.onTrue()
      )
      .select([
        'c.number as claim_number',
        'c.pcr_number',
        'p.first_name',
        'p.last_name',
        'c.service_date',
        'c.status',
        'c.total_cents as charges_cents',
        'b.paid_cents',
        'b.adjusted_cents',
        sql<number>`-b.balance_cents`.as('credit_cents'),
        'paid.at as last_paid_at',
        sql<number | null>`${ctx.today}::date - (paid.at at time zone ${ctx.tz})::date`.as(
          'age_days'
        )
      ])
      .where('c.agency_id', '=', ctx.agencyId)
      .where('b.balance_cents', '<', 0)
      .as('r'),
  columns: [
    'claim_number',
    'pcr_number',
    'first_name',
    'last_name',
    'service_date',
    'status',
    'charges_cents',
    'paid_cents',
    'adjusted_cents',
    'credit_cents',
    'last_paid_at',
    'age_days'
  ],
  order: 'age_days',
  tiebreak: 'claim_number',
  dir: 'desc',
  totals: ['credit_cents']
});
