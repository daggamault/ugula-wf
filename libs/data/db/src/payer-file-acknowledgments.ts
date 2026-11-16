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
  findClaimsByNumber,
  item,
  type PayerEvent,
  type Posted,
  recordPayerEvents,
  unmatchedClaim
} from './payer-file-items.ts';
import type { Db } from './schema.ts';

const SUBMISSIONS = ['submitted', 'resubmitted'] as const;

const lastSubmittedCoverages = async (db: Db, claimIds: readonly string[]) =>
  new Map(
    (claimIds.length
      ? await db
          .selectFrom('claim_events')
          .distinctOn('claim_id')
          .select(['claim_id', 'coverage_id'])
          .where('claim_id', 'in', [...new Set(claimIds)])
          .where('kind', 'in', SUBMISSIONS)
          .orderBy('claim_id')
          .orderBy('created_at', 'desc')
          .orderBy('id', 'desc')
          .execute()
      : []
    ).map((r) => [r.claim_id, r.coverage_id])
  );

const matchSubmittedClaims = async (c: Context, references: readonly string[]) => {
  const claims = await findClaimsByNumber(c.tx, c.agencyId, references);
  const coverages = await lastSubmittedCoverages(
    c.tx,
    [...claims.values()].map((claim) => claim.id)
  );
  return (reference: string) => {
    const claim = claims.get(reference);
    return claim && { id: claim.id, coverageId: coverages.get(claim.id) ?? null };
  };
};

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

const noBatch = (controlNumber: string) =>
  item(controlNumber, null, 'unmatched', `No 837P file has control number ${controlNumber}`);

type Acknowledged = { items: FileItem[]; events: PayerEvent[] };

const acknowledgeBatch = async (
  c: Context,
  controlNumber: string,
  accepted: boolean,
  note: string
): Promise<Acknowledged> => {
  const claims = await findBatchClaims(c.tx, c.agencyId, controlNumber);
  if (!claims.length) return { items: [noBatch(controlNumber)], events: [] };
  const kind = accepted ? 'accepted' : 'rejected';
  const submitted = claims.flatMap((claim) =>
    claim.coverage_id === null ? [] : [{ ...claim, coverage_id: claim.coverage_id }]
  );
  return {
    items: submitted.map((claim) => item(claim.number, claim.claim_id, kind, note)),
    events: submitted.map((claim) => ({
      claimId: claim.claim_id,
      coverageId: claim.coverage_id,
      kind,
      note,
      payerClaimNumber: null,
      key: `${controlNumber}:${claim.claim_id}`
    }))
  };
};

const postAcknowledged = async (c: Context, acknowledged: Acknowledged[]) => {
  await recordPayerEvents(
    c,
    acknowledged.flatMap((a) => a.events)
  );
  return acknowledged.flatMap((a) => a.items);
};

const NOT_SUBMITTED = 'The claim has not been submitted from here';

export const postBatchAcknowledgments = async (
  c: Context,
  groups: GroupAcknowledgment[]
): Promise<Posted> => {
  const acknowledged: Acknowledged[] = [];
  for (const group of groups) {
    const errors = group.transactions.flatMap((t) => t.errors);
    const accepted = group.accepted && group.transactions.every((t) => t.accepted);
    const note = accepted
      ? `The clearinghouse accepted 837P file ${group.groupControlNumber}`
      : `The clearinghouse rejected 837P file ${group.groupControlNumber}${errors.length ? `: ${errors.join('; ')}` : ''}`;
    acknowledged.push(await acknowledgeBatch(c, group.groupControlNumber, accepted, note));
  }
  return { items: await postAcknowledged(c, acknowledged), envelopeRejection: null };
};

const ENVELOPE_REJECTION = 'The clearinghouse rejected the file envelope';

export const postInterchangeAcknowledgments = async (
  c: Context,
  acks: InterchangeAcknowledgment[]
): Promise<Posted> => {
  const acknowledged: Acknowledged[] = [];
  const reasons: string[] = [];
  for (const ack of acks) {
    const number = String(Number(ack.controlNumber) || ack.controlNumber);
    if (ack.status !== 'rejected') {
      const note =
        ack.status === 'accepted'
          ? `The clearinghouse accepted interchange ${number}`
          : `The clearinghouse accepted interchange ${number} with errors: ${ack.message}`;
      acknowledged.push({ items: [item(number, null, 'accepted', note)], events: [] });
      continue;
    }
    const reason = `${ack.message} (TA1 note ${ack.noteCode || 'not given'})`;
    reasons.push(`interchange ${number}: ${reason}`);
    acknowledged.push(
      await acknowledgeBatch(
        c,
        ack.controlNumber,
        false,
        `${ENVELOPE_REJECTION} of 837P file ${number}: ${reason}`
      )
    );
  }
  return {
    items: await postAcknowledged(c, acknowledged),
    envelopeRejection: reasons.length ? `${ENVELOPE_REJECTION}: ${reasons.join('; ')}` : null
  };
};

export const postClaimAcknowledgments = async (
  c: Context,
  acks: ClaimAcknowledgment[]
): Promise<Posted> => {
  const match = await matchSubmittedClaims(
    c,
    acks.map((a) => a.claimNumber)
  );
  const items: FileItem[] = [];
  const events: PayerEvent[] = [];
  for (const [i, ack] of acks.entries()) {
    const claim = match(ack.claimNumber);
    if (!claim) {
      items.push(unmatchedClaim(ack.claimNumber));
      continue;
    }
    if (ack.status === 'pending' || claim.coverageId === null) {
      items.push(
        item(
          ack.claimNumber,
          claim.id,
          'review',
          claim.coverageId === null
            ? NOT_SUBMITTED
            : `Pending: ${ack.message || ack.categories.join(', ')}`
        )
      );
      continue;
    }
    const accepted = ack.status === 'accepted';
    const kind = accepted ? 'accepted' : 'rejected';
    const note = `${accepted ? 'Accepted' : 'Rejected'} (${ack.categories.join(', ')})${ack.message ? `: ${ack.message}` : ''}`;
    events.push({
      claimId: claim.id,
      coverageId: claim.coverageId,
      kind,
      note,
      payerClaimNumber: accepted ? ack.payerClaimNumber : null,
      key: String(i + 1)
    });
    items.push(item(ack.claimNumber, claim.id, kind, note));
  }
  await recordPayerEvents(c, events);
  return { items, envelopeRejection: null };
};

export const postClaimStatuses = async (
  c: Context,
  statuses: PayerClaimStatus[]
): Promise<Posted> => {
  const match = await matchSubmittedClaims(
    c,
    statuses.map((s) => s.claimNumber)
  );
  const items: FileItem[] = [];
  const events: PayerEvent[] = [];
  for (const [i, s] of statuses.entries()) {
    const claim = match(s.claimNumber);
    if (!claim) {
      items.push(unmatchedClaim(s.claimNumber));
      continue;
    }
    if (claim.coverageId === null) {
      items.push(item(s.claimNumber, claim.id, 'review', NOT_SUBMITTED));
      continue;
    }
    const note = claimStatusNote(s);
    events.push({
      claimId: claim.id,
      coverageId: claim.coverageId,
      kind: 'claim_status',
      note,
      payerClaimNumber: s.payerClaimNumber,
      key: String(i + 1)
    });
    items.push(item(s.claimNumber, claim.id, 'status', note));
  }
  await recordPayerEvents(c, events);
  return { items, envelopeRejection: null };
};
