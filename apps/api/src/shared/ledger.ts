import type { ClaimEvent } from '@ugula/billing';
import type { Db } from '@ugula/db';
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
    at: new Date(e.created_at).toISOString()
  }));
