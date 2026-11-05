import { sql } from 'kysely';
import { report } from './report.ts';
import { UNRECOVERED, within } from './report-sql.ts';

export const writeOffsReport = report({
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
      .where('c.agency_id', '=', ctx.agencyId)
      .where('e.kind', '=', 'closed')
      .where('e.note', 'in', UNRECOVERED)
      .where(within(sql.ref('e.created_at'), ctx))
      .as('r'),
  columns: [
    'id',
    'closed_at',
    'claim_number',
    'pcr_number',
    'first_name',
    'last_name',
    'service_date',
    'outcome',
    'charges_cents',
    'paid_cents',
    'adjusted_cents',
    'balance_cents'
  ],
  order: 'closed_at',
  tiebreak: 'id',
  dir: 'asc',
  totals: ['charges_cents', 'paid_cents', 'adjusted_cents', 'balance_cents']
});
