import { dailyNumberOf, type PayerFileOutcome, type RemittancePosting } from '@ugula/billing';
import type { RunQueueClient } from '@ugula/run-queue';
import { nudgeClaim } from './claim-responses.ts';
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

export type Posted = { items: FileItem[]; envelopeRejection: string | null };

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

export const findClaimByNumber = (db: Db, agencyId: string, reference: string) => {
  const number = dailyNumberOf(reference);
  return number === null
    ? Promise.resolve(undefined)
    : db
        .selectFrom('claims')
        .select(['id', 'status'])
        .where('agency_id', '=', agencyId)
        .where('number', '=', number)
        .executeTakeFirst();
};

const insertPayerEvent = async (
  db: Db,
  a: {
    claimId: string;
    coverageId: string;
    kind: 'accepted' | 'rejected' | 'eligibility' | 'claim_status';
    note: string;
    payerClaimNumber: string | null;
    sourceKey: string;
    createdBy: string | null;
  }
) =>
  (await db
    .insertInto('claim_events')
    .values({
      claim_id: a.claimId,
      kind: a.kind,
      coverage_id: a.coverageId,
      note: a.note,
      payer_claim_number: a.payerClaimNumber,
      created_by: a.createdBy,
      source_key: a.sourceKey
    })
    .onConflict((oc) => oc.columns(['claim_id', 'source_key']).doNothing())
    .returning('id')
    .executeTakeFirst()) !== undefined;

export const recordPayerEvent = async (
  c: Context,
  claimId: string,
  coverageId: string,
  e: {
    kind: 'accepted' | 'rejected' | 'eligibility' | 'claim_status';
    note: string;
    payerClaimNumber: string | null;
    key: string;
  }
) => {
  await insertPayerEvent(c.tx, {
    claimId,
    coverageId,
    kind: e.kind,
    note: e.note,
    payerClaimNumber: e.payerClaimNumber,
    sourceKey: `${c.digest}:${e.key}`,
    createdBy: c.userId
  });
  await nudgeClaim(c.tx, c.boss, c.agencyId, claimId);
};
