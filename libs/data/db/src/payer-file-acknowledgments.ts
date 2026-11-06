import {
  type ClaimAcknowledgment,
  claimStatusNote,
  type GroupAcknowledgment,
  type InterchangeAcknowledgment,
  type PayerClaimStatus
} from '@ugula/billing';
import {
  type Context,
  controlNumberOf,
  type FileItem,
  findClaimByNumber,
  item,
  notBillable,
  type Posted,
  recordPayerEvent
} from './payer-file-items.ts';
import type { Db } from './schema.ts';

const SUBMISSIONS = ['submitted', 'resubmitted'] as const;

const lastSubmittedCoverage = async (db: Db, claimId: string) =>
  (
    await db
      .selectFrom('claim_events')
      .select('coverage_id')
      .where('claim_id', '=', claimId)
      .where('kind', 'in', SUBMISSIONS)
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(1)
      .executeTakeFirst()
  )?.coverage_id ?? null;

const findBatchClaims = (db: Db, agencyId: string, controlNumber: string) => {
  const number = controlNumberOf(controlNumber);
  return number === null
    ? Promise.resolve([])
    : db
        .selectFrom('claim_batches as b')
        .innerJoin('claim_events as e', 'e.batch_id', 'b.id')
        .innerJoin('claims as c', 'c.id', 'e.claim_id')
        .select(['e.claim_id', 'e.coverage_id', 'c.number'])
        .distinct()
        .where('b.agency_id', '=', agencyId)
        .where('b.control_number', '=', number)
        .where('e.kind', 'in', SUBMISSIONS)
        .execute();
};

const markBatchRejected = (
  db: Db,
  agencyId: string,
  controlNumber: number,
  rejection: string,
  at: Date
) =>
  db
    .updateTable('claim_batches')
    .set({ rejected_at: at, rejection })
    .where('agency_id', '=', agencyId)
    .where('control_number', '=', controlNumber)
    .execute();

const noBatch = (controlNumber: string) =>
  item(controlNumber, null, 'unmatched', `No 837P file has control number ${controlNumber}`);

const acknowledgeBatch = async (
  c: Context,
  controlNumber: string,
  accepted: boolean,
  note: string
) => {
  const claims = await findBatchClaims(c.tx, c.agencyId, controlNumber);
  if (!claims.length) return [noBatch(controlNumber)];
  const items: FileItem[] = [];
  for (const claim of claims) {
    if (claim.coverage_id === null) continue;
    await recordPayerEvent(c, claim.claim_id, claim.coverage_id, {
      kind: accepted ? 'accepted' : 'rejected',
      note,
      payerClaimNumber: null,
      key: `${controlNumber}:${claim.claim_id}`
    });
    items.push(item(claim.number, claim.claim_id, accepted ? 'accepted' : 'rejected', note));
  }
  return items;
};

const NOT_SUBMITTED = 'The claim has not been submitted from here';

export const postBatchAcknowledgments = async (
  c: Context,
  groups: GroupAcknowledgment[]
): Promise<Posted> => {
  const items: FileItem[] = [];
  for (const group of groups) {
    const errors = group.transactions.flatMap((t) => t.errors);
    const accepted = group.accepted && group.transactions.every((t) => t.accepted);
    const note = accepted
      ? `The clearinghouse accepted 837P file ${group.groupControlNumber}`
      : `The clearinghouse rejected 837P file ${group.groupControlNumber}${errors.length ? `: ${errors.join('; ')}` : ''}`;
    items.push(...(await acknowledgeBatch(c, group.groupControlNumber, accepted, note)));
  }
  return { items, envelopeRejection: null };
};

const ENVELOPE_REJECTION = 'The clearinghouse rejected the file envelope';

export const postInterchangeAcknowledgments = async (
  c: Context,
  acks: InterchangeAcknowledgment[]
): Promise<Posted> => {
  const items: FileItem[] = [];
  const reasons: string[] = [];
  for (const ack of acks) {
    const number = String(Number(ack.controlNumber) || ack.controlNumber);
    if (ack.status !== 'rejected') {
      items.push(
        item(
          number,
          null,
          'accepted',
          ack.status === 'accepted'
            ? `The clearinghouse accepted interchange ${number}`
            : `The clearinghouse accepted interchange ${number} with errors: ${ack.message}`
        )
      );
      continue;
    }
    const reason = `${ack.message} (TA1 note ${ack.noteCode || 'not given'})`;
    reasons.push(`interchange ${number}: ${reason}`);
    const control = Number(ack.controlNumber);
    if (Number.isSafeInteger(control) && control > 0) {
      await markBatchRejected(c.tx, c.agencyId, control, reason, c.now);
    }
    items.push(
      ...(await acknowledgeBatch(
        c,
        ack.controlNumber,
        false,
        `${ENVELOPE_REJECTION} of 837P file ${number}: ${reason}`
      ))
    );
  }
  return {
    items,
    envelopeRejection: reasons.length ? `${ENVELOPE_REJECTION}: ${reasons.join('; ')}` : null
  };
};

export const postClaimAcknowledgments = async (
  c: Context,
  acks: ClaimAcknowledgment[]
): Promise<Posted> => {
  const items: FileItem[] = [];
  let n = 0;
  for (const ack of acks) {
    n += 1;
    const claim = await findClaimByNumber(c.tx, c.agencyId, ack.claimNumber);
    if (!claim) {
      items.push(notBillable(ack.claimNumber));
      continue;
    }
    const coverageId = await lastSubmittedCoverage(c.tx, claim.id);
    if (ack.status === 'pending' || coverageId === null) {
      items.push(
        item(
          ack.claimNumber,
          claim.id,
          'review',
          coverageId === null
            ? NOT_SUBMITTED
            : `Pending: ${ack.message || ack.categories.join(', ')}`
        )
      );
      continue;
    }
    const accepted = ack.status === 'accepted';
    const note = `${accepted ? 'Accepted' : 'Rejected'} (${ack.categories.join(', ')})${ack.message ? `: ${ack.message}` : ''}`;
    await recordPayerEvent(c, claim.id, coverageId, {
      kind: accepted ? 'accepted' : 'rejected',
      note,
      payerClaimNumber: ack.payerClaimNumber,
      key: String(n)
    });
    items.push(item(ack.claimNumber, claim.id, accepted ? 'accepted' : 'rejected', note));
  }
  return { items, envelopeRejection: null };
};

export const postClaimStatuses = async (
  c: Context,
  statuses: PayerClaimStatus[]
): Promise<Posted> => {
  const items: FileItem[] = [];
  let n = 0;
  for (const s of statuses) {
    n += 1;
    const claim = await findClaimByNumber(c.tx, c.agencyId, s.claimNumber);
    if (!claim) {
      items.push(notBillable(s.claimNumber));
      continue;
    }
    const coverageId = await lastSubmittedCoverage(c.tx, claim.id);
    if (coverageId === null) {
      items.push(item(s.claimNumber, claim.id, 'review', NOT_SUBMITTED));
      continue;
    }
    const note = claimStatusNote(s);
    await recordPayerEvent(c, claim.id, coverageId, {
      kind: 'claim_status',
      note,
      payerClaimNumber: s.payerClaimNumber,
      key: String(n)
    });
    items.push(item(s.claimNumber, claim.id, 'status', note));
  }
  return { items, envelopeRejection: null };
};
