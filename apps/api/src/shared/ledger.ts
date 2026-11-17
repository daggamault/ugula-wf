import type { ClaimEvent, LedgerPlan } from '@ugula/billing';
import { agencyTimeZone, type Db } from '@ugula/db';
import { sql } from 'kysely';
import { jsonArrayFrom } from 'kysely/helpers/postgres';

export const listLedgerEvents = async (db: Db, claimId: string): Promise<ClaimEvent[]> =>
  (
    await db
      .selectFrom('claim_events as e')
      .select((eb) => [
        'e.kind',
        'e.coverage_id',
        'e.paid_cents',
        'e.adjusted_cents',
        'e.payer_claim_number',
        'e.paid_on',
        'e.note',
        'e.route',
        'e.created_at',
        jsonArrayFrom(
          eb
            .selectFrom('claim_event_adjustments as a')
            .select(['a.group_code as group', 'a.reason_code as reason', 'a.amount_cents as cents'])
            .whereRef('a.event_id', '=', 'e.id')
            .orderBy('a.position')
        ).as('adjustments')
      ])
      .where('e.claim_id', '=', claimId)
      .orderBy('e.created_at')
      .orderBy('e.id')
      .execute()
  ).map((e) => ({
    kind: e.kind,
    coverageId: e.coverage_id,
    paidCents: e.paid_cents,
    adjustedCents: e.adjusted_cents,
    payerClaimNumber: e.payer_claim_number,
    paidOn: e.paid_on,
    adjustments: e.adjustments,
    note: e.note,
    route: e.route,
    at: new Date(e.created_at).toISOString()
  }));

export const findActivePlan = async (db: Db, claimId: string): Promise<LedgerPlan | null> => {
  const plan = await db
    .selectFrom('payment_plans')
    .select(['installment_cents', 'interval_days', 'first_due_on', 'missed_count', 'created_at'])
    .select(agencyTimeZone(sql.ref('payment_plans.agency_id')).as('time_zone'))
    .where('claim_id', '=', claimId)
    .where('status', '=', 'active')
    .executeTakeFirst();
  return plan
    ? {
        installmentCents: plan.installment_cents,
        intervalDays: plan.interval_days,
        firstDueOn: plan.first_due_on,
        missedCount: plan.missed_count,
        startedAt: new Date(plan.created_at).toISOString(),
        timeZone: plan.time_zone
      }
    : null;
};
