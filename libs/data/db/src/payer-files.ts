import { createHash } from 'node:crypto';
import {
  type ClaimAcknowledgment,
  claimStatusNote,
  type EligibilityResult,
  eligibilityFinding,
  type GroupAcknowledgment,
  type InboundKind,
  type InterchangeAcknowledgment,
  isDenialRoute,
  type PayerClaimStatus,
  type PayerFileOutcome,
  PROBLEM_OUTCOMES,
  type Remittance,
  type RemittanceLine,
  type RemittancePosting,
  read271,
  read277,
  read835,
  read999,
  readClaimStatus,
  readTA1,
  readX12,
  remittanceCoverage,
  remittanceLine
} from '@ugula/billing';
import type { RunQueueClient } from '@ugula/run-queue';
import { sql } from 'kysely';
import { nudgeClaim, postClaimResponse } from './claim-responses.ts';
import { fail, ok, type Result } from './result.ts';
import type { Db } from './schema.ts';

export const findImported = (db: Db, agencyId: string, digest: string) =>
  db
    .selectFrom('payer_files')
    .select(['id', 'created_at'])
    .where('agency_id', '=', agencyId)
    .where('digest', '=', digest)
    .executeTakeFirst();

const insertPayerFile = (
  db: Db,
  f: {
    agencyId: string;
    kind: InboundKind;
    fileName: string;
    digest: string;
    document: unknown;
    controlNumber: string | null;
    uploadedBy: string | null;
  }
) =>
  db
    .insertInto('payer_files')
    .values({
      agency_id: f.agencyId,
      kind: f.kind,
      file_name: f.fileName,
      digest: f.digest,
      document: JSON.stringify(f.document),
      control_number: f.controlNumber,
      uploaded_by: f.uploadedBy
    })
    .returning('id')
    .executeTakeFirstOrThrow();

export type FileItem = {
  reference: string;
  claimId: string | null;
  outcome: PayerFileOutcome;
  message: string;
  paidCents: number | null;
  adjustedCents: number | null;
};

export const saveFileItems = async (
  db: Db,
  fileId: string,
  items: readonly FileItem[],
  problems: number
) => {
  if (items.length) {
    await db
      .insertInto('payer_file_items')
      .values(
        items.map((item, i) => ({
          file_id: fileId,
          position: i + 1,
          reference: item.reference,
          claim_id: item.claimId,
          outcome: item.outcome,
          message: item.message,
          paid_cents: item.paidCents,
          adjusted_cents: item.adjustedCents
        }))
      )
      .execute();
  }
  await db
    .updateTable('payer_files')
    .set({ item_count: items.length, problem_count: problems })
    .where('id', '=', fileId)
    .execute();
};

const claimNumberOf = (reference: string) => {
  const n = Number(reference.trim());
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

export const findClaimByNumber = (db: Db, agencyId: string, reference: string) => {
  const number = claimNumberOf(reference);
  return number === null
    ? Promise.resolve(undefined)
    : db
        .selectFrom('claims')
        .select(['id', 'status'])
        .where('agency_id', '=', agencyId)
        .where('number', '=', number)
        .executeTakeFirst();
};

const listPostingCoverages = (db: Db, claimId: string) =>
  db
    .selectFrom('claim_coverages as cc')
    .leftJoin('payers as dp', 'dp.id', 'cc.payer_id')
    .select(['cc.id', 'dp.payer_id as payerId'])
    .where('cc.claim_id', '=', claimId)
    .orderBy('cc.position')
    .execute();

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

export const findBatchClaims = (db: Db, agencyId: string, controlNumber: string) => {
  const number = claimNumberOf(controlNumber);
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

export const insertPayerEvent = async (
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

export const findTracedCoverage = (db: Db, agencyId: string, trace: string) =>
  db
    .selectFrom('claim_coverages')
    .leftJoin('payers', 'payers.id', 'claim_coverages.payer_id')
    .select(['claim_coverages.id', 'claim_coverages.claim_id', 'payers.claim_filing'])
    .where('claim_coverages.agency_id', '=', agencyId)
    .where(sql<string>`claim_coverages.id::text`, '=', trace.toLowerCase())
    .executeTakeFirst();

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

const saveEligibility = (
  db: Db,
  coverageId: string,
  e: { active: boolean; note: string; checkedAt: Date }
) =>
  db
    .updateTable('claim_coverages')
    .set({
      eligibility: e.active ? 'active' : 'inactive',
      eligibility_note: e.note || null,
      eligibility_checked_at: e.checkedAt
    })
    .where('id', '=', coverageId)
    .execute();

type Context = {
  tx: Db;
  boss: RunQueueClient;
  agencyId: string;
  userId: string | null;
  digest: string;
  fileName: string;
  now: Date;
  postings: readonly RemittancePosting[];
};

const item = (
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

const noClaim = (reference: string) =>
  item(reference, null, 'unmatched', `No claim has number ${reference}`);

const matchRemittance = async (
  db: Db,
  agencyId: string,
  remit: Remittance,
  claimNumber: string,
  status: string
) => {
  const claim = await findClaimByNumber(db, agencyId, claimNumber);
  const coverage = claim
    ? remittanceCoverage(await listPostingCoverages(db, claim.id), remit.payerId, status)
    : null;
  return { claimId: claim?.id ?? null, coverageId: coverage?.id ?? null };
};

const eachClaimPayment = (remittances: Remittance[]) =>
  remittances
    .flatMap((remit) => remit.claims.map((rc) => ({ remit, rc })))
    .map((x, i) => ({
      ...x,
      position: i + 1
    }));

export const readRemittanceLines = async (
  db: Db,
  agencyId: string,
  text: string
): Promise<RemittanceLine[]> => {
  const lines: RemittanceLine[] = [];
  for (const { remit, rc, position } of eachClaimPayment(read835(text))) {
    const matched = await matchRemittance(db, agencyId, remit, rc.claimNumber, rc.status);
    lines.push(remittanceLine(position, rc, { ...matched, payerName: remit.payerName }));
  }
  return lines;
};

const postRemittances = async (c: Context, remittances: Remittance[]) => {
  const items: FileItem[] = [];
  for (const { remit, rc, position } of eachClaimPayment(remittances)) {
    const posting = c.postings.find((p) => p.position === position);
    if (!posting)
      throw new Error(`No posting was decided for claim payment ${position} of the file`);
    const { claimId, coverageId } = await matchRemittance(
      c.tx,
      c.agencyId,
      remit,
      rc.claimNumber,
      rc.status
    );
    if (!claimId || posting.route === 'unmatched') {
      items.push(
        item(
          rc.claimNumber,
          claimId,
          'unmatched',
          posting.message || `No claim has number ${rc.claimNumber}`
        )
      );
      continue;
    }
    if (posting.route === 'review' || !coverageId) {
      items.push(
        item(
          rc.claimNumber,
          claimId,
          'review',
          posting.message ||
            `${remit.payerName ?? 'The payer'} is not a payer on this claim; post the payment by hand`
        )
      );
      continue;
    }
    const line = remittanceLine(position, rc, { claimId, coverageId, payerName: remit.payerName });
    const amounts = { paidCents: line.paidCents, adjustedCents: posting.adjustedCents };
    const posted = await postClaimResponse(c.tx, c.boss, c.agencyId, claimId, c.userId, {
      requestId: `${c.digest}:${position}`,
      kind: 'response',
      coverageId,
      ...amounts,
      paidOn: remit.paidOn,
      checkNumber: remit.checkNumber,
      payerClaimNumber: rc.payerClaimNumber,
      adjustments: line.adjustments,
      note: `${rc.denied ? 'Denied' : 'Remittance'} from ${remit.payerName ?? 'the payer'} in ${c.fileName}`
    });
    if (posted.ok && !posted.value.duplicate && isDenialRoute(posting.route)) {
      await c.tx
        .insertInto('claim_events')
        .values({
          claim_id: claimId,
          kind: 'denied',
          coverage_id: coverageId,
          route: posting.route,
          note: posting.message || `Denied by ${remit.payerName ?? 'the payer'}`,
          created_by: c.userId,
          source_key: `${c.digest}:${position}:denied`
        })
        .onConflict((oc) => oc.columns(['claim_id', 'source_key']).doNothing())
        .execute();
    }
    items.push(
      posted.ok
        ? item(
            rc.claimNumber,
            claimId,
            posted.value.duplicate ? 'duplicate' : 'posted',
            rc.denied ? 'Denied' : '',
            amounts
          )
        : item(rc.claimNumber, claimId, 'review', posted.failure.message)
    );
  }
  return items;
};

const recordPayerEvent = async (
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
    items.push(
      item(String(claim.number), claim.claim_id, accepted ? 'accepted' : 'rejected', note)
    );
  }
  return items;
};

const postBatchAcknowledgments = async (c: Context, groups: GroupAcknowledgment[]) => {
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

const postInterchangeAcknowledgments = async (c: Context, acks: InterchangeAcknowledgment[]) => {
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

const postClaimAcknowledgments = async (c: Context, acks: ClaimAcknowledgment[]) => {
  const items: FileItem[] = [];
  let n = 0;
  for (const ack of acks) {
    n += 1;
    const claim = await findClaimByNumber(c.tx, c.agencyId, ack.claimNumber);
    if (!claim) {
      items.push(noClaim(ack.claimNumber));
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

const NOT_SUBMITTED = 'The claim has not been submitted from here';

const postClaimStatuses = async (c: Context, statuses: PayerClaimStatus[]) => {
  const items: FileItem[] = [];
  let n = 0;
  for (const s of statuses) {
    n += 1;
    const claim = await findClaimByNumber(c.tx, c.agencyId, s.claimNumber);
    if (!claim) {
      items.push(noClaim(s.claimNumber));
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

const eligibilityLabel = (active: boolean | null) =>
  active === null ? null : active ? 'Coverage active' : 'Coverage not active';

const postEligibility = async (c: Context, results: EligibilityResult[]) => {
  const items: FileItem[] = [];
  let n = 0;
  for (const r of results) {
    n += 1;
    const coverage = await findTracedCoverage(c.tx, c.agencyId, r.trace);
    if (!coverage) {
      items.push(item(r.trace, null, 'unmatched', 'No payer on a claim matches this response'));
      continue;
    }
    const found = eligibilityFinding(r, coverage.claim_filing);
    if (found.active !== null) {
      await saveEligibility(c.tx, coverage.id, {
        active: found.active,
        note: found.note,
        checkedAt: c.now
      });
    }
    await recordPayerEvent(c, coverage.claim_id, coverage.id, {
      kind: 'eligibility',
      note: [eligibilityLabel(found.active), found.note].filter(Boolean).join(': '),
      payerClaimNumber: null,
      key: String(n)
    });
    items.push(item(r.trace, coverage.claim_id, found.outcome, found.note));
  }
  return { items, envelopeRejection: null };
};

type Posted = { items: FileItem[]; envelopeRejection: string | null };

const PROCESSORS: Record<InboundKind, (c: Context, text: string) => Promise<Posted>> = {
  '835': async (c, text) => ({
    items: await postRemittances(c, read835(text)),
    envelopeRejection: null
  }),
  '999': (c, text) => postBatchAcknowledgments(c, read999(text)),
  '277': (c, text) => postClaimAcknowledgments(c, read277(text)),
  '271': (c, text) => postEligibility(c, read271(text)),
  TA1: (c, text) => postInterchangeAcknowledgments(c, readTA1(text)),
  '277S': (c, text) => postClaimStatuses(c, readClaimStatus(text))
};

const kindOf = (text: string) => {
  try {
    return readX12(text);
  } catch {
    return null;
  }
};

type InboundFile = {
  kind: InboundKind;
  controlNumber: string | null;
  digest: string;
  text: string;
};

export const readPayerFile = (bytes: Uint8Array): Result<InboundFile> => {
  if (!bytes.byteLength) return fail('invalid', 'The file is empty');
  const text = new TextDecoder().decode(bytes);
  const x12 = kindOf(text);
  if (!x12?.kind) {
    return fail(
      'invalid',
      'This is not a remittance (835), acknowledgment (TA1, 999 or 277CA), claim status (277) or eligibility (271) file'
    );
  }
  return ok({
    kind: x12.kind,
    controlNumber: x12.controlNumber,
    digest: createHash('sha256').update(bytes).digest('hex'),
    text
  });
};

export const applyPayerFile = async (
  tx: Db,
  boss: RunQueueClient,
  f: {
    agencyId: string;
    userId: string | null;
    fileName: string;
    document: unknown;
    file: InboundFile;
    now: Date;
    postings: readonly RemittancePosting[];
  }
) => {
  const { id } = await insertPayerFile(tx, {
    agencyId: f.agencyId,
    kind: f.file.kind,
    fileName: f.fileName,
    digest: f.file.digest,
    document: f.document,
    controlNumber: f.file.controlNumber,
    uploadedBy: f.userId
  });
  const { items, envelopeRejection } = await PROCESSORS[f.file.kind](
    {
      tx,
      boss,
      agencyId: f.agencyId,
      userId: f.userId,
      digest: f.file.digest,
      fileName: f.fileName,
      now: f.now,
      postings: f.postings
    },
    f.file.text
  );
  const problems = items.filter((i) => PROBLEM_OUTCOMES.includes(i.outcome)).length;
  await saveFileItems(tx, id, items, problems);
  return { id, kind: f.file.kind, items, problems, envelopeRejection };
};
