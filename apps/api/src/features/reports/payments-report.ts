import { payerName } from '@ugula/db';
import { sql } from 'kysely';
import { report } from './report.ts';
import { reasonCode, within } from './report-sql.ts';

const PAYMENTS = ['response', 'refunded'] as const;

export const paymentsReport = report({
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
          .leftJoin('codes as d', (j) =>
            j.on('d.code_set', '=', 'carc').onRef('d.code', '=', 'a.reason_code')
          )
          .select(
            sql<string>`case when d.description is null then ${reasonCode} else d.description || ' (' || ${reasonCode} || ')' end`.as(
              'code'
            )
          )
          .where('a.event_id', '=', sql.ref<string>('e.id'))
          .orderBy('a.position')}), '; ')`.as('reason_codes'),
        'u.email as posted_by',
        'e.note'
      ])
      .where('c.agency_id', '=', ctx.agencyId)
      .where('e.kind', 'in', PAYMENTS)
      .where(within(sql.ref('e.created_at'), ctx))
      .as('r'),
  columns: [
    'id',
    'posted_at',
    'claim_number',
    'pcr_number',
    'first_name',
    'last_name',
    'service_date',
    'payer',
    'filing',
    'kind',
    'paid_on',
    'check_number',
    'payer_claim_number',
    'paid_cents',
    'adjusted_cents',
    'reason_codes',
    'posted_by',
    'note'
  ],
  order: 'posted_at',
  tiebreak: 'id',
  dir: 'asc',
  totals: ['paid_cents', 'adjusted_cents']
});
