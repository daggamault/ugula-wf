import type { Db } from '@ugula/db';
import { sql } from 'kysely';
import { containsPattern } from '../../shared/search.ts';

export type Period = { from: string; to: string; payer?: string | undefined };

export const REPORT_ROW_LIMIT = 1000;

const paidOn = sql<string>`coalesce(r.paid_on, r.created_at::date)`;

const inPeriod = (db: Db, agencyId: string, p: Period) => {
  let q = db
    .selectFrom('remittances as r')
    .where('r.agency_id', '=', agencyId)
    .where(paidOn, '>=', p.from)
    .where(paidOn, '<=', p.to);
  if (p.payer) {
    q = q.where(sql`lower(coalesce(r.payer_name, ''))`, 'like', containsPattern(p.payer));
  }
  return q;
};

export const findRemittances = (db: Db, agencyId: string, p: Period) =>
  inPeriod(db, agencyId, p)
    .select((eb) => [
      'r.id',
      paidOn.as('paid_on'),
      'r.payer_name',
      'r.trace_number',
      'r.payment_method',
      'r.total_cents',
      'r.claim_paid_cents',
      'r.provider_adjustment_cents',
      'r.unmatched_count',
      'r.is_balanced',
      'r.reconciled_at',
      eb
        .selectFrom('claim_payments as p')
        .select((s) => s.fn.countAll<number>().as('n'))
        .whereRef('p.remittance_id', '=', 'r.id')
        .as('payment_count')
    ])
    .orderBy(paidOn)
    .orderBy('r.created_at')
    .limit(REPORT_ROW_LIMIT + 1)
    .execute();

export const findUnmatchedPayments = (db: Db, agencyId: string, p: Period) =>
  inPeriod(db, agencyId, p)
    .innerJoin('claim_payments as p', 'p.remittance_id', 'r.id')
    .select([
      'p.id',
      paidOn.as('paid_on'),
      'r.payer_name',
      'r.trace_number',
      'p.claim_number',
      'p.charge_cents',
      'p.paid_cents',
      'p.patient_cents',
      'p.payer_claim_number'
    ])
    .where('p.claim_id', 'is', null)
    .orderBy(paidOn)
    .orderBy('p.claim_number')
    .limit(REPORT_ROW_LIMIT)
    .execute();
