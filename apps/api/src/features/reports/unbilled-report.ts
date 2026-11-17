import { sql } from 'kysely';
import { report } from './report.ts';

const PRE_SUBMISSION = ['draft', 'needs_review', 'ready'] as const;

export const unbilledReport = report({
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
      .leftJoinLateral(
        (eb) =>
          eb
            .selectFrom('claim_coverages as cc')
            .leftJoin('payers as dp', 'dp.id', 'cc.payer_id')
            .select('dp.filing_limit_days')
            .whereRef('cc.claim_id', '=', 'c.id')
            .orderBy('cc.position')
            .limit(1)
            .as('pp'),
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
        sql<string | null>`c.service_date + pp.filing_limit_days`.as('file_by'),
        'c.total_cents as charges_cents'
      ])
      .where('c.agency_id', '=', ctx.agencyId)
      .where('c.status', 'in', PRE_SUBMISSION)
      .as('r'),
  columns: [
    'claim_number',
    'pcr_number',
    'first_name',
    'last_name',
    'service_date',
    'status',
    'queue',
    'age_days',
    'file_by',
    'charges_cents'
  ],
  order: 'age_days',
  tiebreak: 'claim_number',
  dir: 'desc',
  totals: ['charges_cents']
});
