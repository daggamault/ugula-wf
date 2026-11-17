import {
  dailyNumberOf,
  type PayerFileOutcome,
  type PaymentMethod,
  type RemittancePosting
} from '@ugula/billing';
import type { RunQueueClient } from '@ugula/run-queue';
import { nudgeClaims } from './claim-responses.ts';
import type { Db } from './schema.ts';

export type FileItem = {
  reference: string;
  claimId: string | null;
  outcome: PayerFileOutcome;
  message: string;
  paidCents: number | null;
  adjustedCents: number | null;
};

export type Context = {
  tx: Db;
  boss: RunQueueClient;
  agencyId: string;
  userId: string | null;
  digest: string;
  fileName: string;
  now: Date;
  postings: readonly RemittancePosting[];
};

export type Payment = {
  cents: number;
  method: PaymentMethod | null;
  paidOn: string | null;
  traceNumber: string | null;
  tracePayerId: string | null;
};

export type Posted = {
  items: FileItem[];
  envelopeRejection: string | null;
  payment?: Payment | null;
};

export const item = (
  reference: string,
  claimId: string | null,
  outcome: FileItem['outcome'],
  message = '',
  amounts: { paidCents: number; adjustedCents: number } | null = null
): FileItem => ({
  reference,
  claimId,
  outcome,
  message,
  paidCents: amounts?.paidCents ?? null,
  adjustedCents: amounts?.adjustedCents ?? null
});

export const unmatchedClaim = (reference: string) =>
  item(reference, null, 'unmatched', `No claim has number ${reference}`);

export const controlNumberOf = (reference: string) => {
  const n = Number(reference.trim());
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

export const findClaimsByNumber = async (
  db: Db,
  agencyId: string,
  references: readonly string[]
) => {
  const numbers = new Map(
    references.flatMap((r) => {
      const number = dailyNumberOf(r);
      return number === null ? [] : [[r, number] as const];
    })
  );
  const rows = numbers.size
    ? await db
        .selectFrom('claims')
        .select(['id', 'number', 'status'])
        .where('agency_id', '=', agencyId)
        .where('number', 'in', [...new Set(numbers.values())])
        .execute()
    : [];
  const byNumber = new Map(rows.map((r) => [r.number, { id: r.id, status: r.status }]));
  return new Map(
    [...numbers].flatMap(([reference, number]) => {
      const claim = byNumber.get(number);
      return claim ? [[reference, claim] as const] : [];
    })
  );
};

export type PayerEvent = {
  claimId: string;
  coverageId: string;
  kind: 'accepted' | 'rejected' | 'eligibility' | 'claim_status';
  note: string;
  payerClaimNumber: string | null;
  key: string;
};

export const recordPayerEvents = async (c: Context, events: readonly PayerEvent[]) => {
  if (!events.length) return;
  await c.tx
    .insertInto('claim_events')
    .values(
      events.map((e) => ({
        agency_id: c.agencyId,
        claim_id: e.claimId,
        kind: e.kind,
        coverage_id: e.coverageId,
        note: e.note,
        payer_claim_number: e.payerClaimNumber,
        created_by_id: c.userId,
        source_key: `${c.digest}:${e.key}`
      }))
    )
    .onConflict((oc) => oc.columns(['claim_id', 'source_key']).doNothing())
    .execute();
  await nudgeClaims(
    c.tx,
    c.boss,
    c.agencyId,
    events.map((e) => e.claimId)
  );
};
