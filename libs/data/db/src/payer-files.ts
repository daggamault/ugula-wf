import { createHash } from 'node:crypto';
import {
  type ClaimAcknowledgment,
  type EligibilityResult,
  type GroupAcknowledgment,
  type InboundKind,
  type PayerFileOutcome,
  PROBLEM_OUTCOMES,
  type Remittance,
  read271,
  read277,
  read835,
  read999,
  readX12,
  remittanceCoverage,
  remittancePosting
} from '@ugula/billing';
import type { RunQueueClient } from '@ugula/run-queue';
import { sql } from 'kysely';
import { nudgeClaim, postClaimResponse } from './claim-responses.ts';
import { fail, ok, type Result } from './result.ts';
import type { Db } from './schema.ts';

export const findImported = (db: Db, tenantId: string, digest: string) =>
  db
    .selectFrom('payer_files')
    .select(['id', 'created_at'])
    .where('tenant_id', '=', tenantId)
    .where('digest', '=', digest)
    .executeTakeFirst();

export const insertPayerFile = (
  db: Db,
  f: {
    tenantId: string;
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
      tenant_id: f.tenantId,
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

export const findClaimByNumber = (db: Db, tenantId: string, reference: string) => {
  const number = claimNumberOf(reference);
  return number === null
    ? Promise.resolve(undefined)
    : db
        .selectFrom('claims')
        .select(['id', 'status'])
        .where('tenant_id', '=', tenantId)
        .where('number', '=', number)
        .executeTakeFirst();
};

export const listPostingCoverages = (db: Db, claimId: string) =>
  db
    .selectFrom('claim_coverages as cc')
    .leftJoin('payers as dp', 'dp.id', 'cc.payer_id')
    .select(['cc.id', 'dp.payer_id as payerId'])
    .where('cc.claim_id', '=', claimId)
    .orderBy('cc.position')
    .execute();

const SUBMISSIONS = ['submitted', 'resubmitted'] as const;

export const lastSubmittedCoverage = async (db: Db, claimId: string) =>
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

export const findBatchClaims = (db: Db, tenantId: string, controlNumber: string) => {
  const number = claimNumberOf(controlNumber);
  return number === null
    ? Promise.resolve([])
    : db
        .selectFrom('claim_batches as b')
        .innerJoin('claim_events as e', 'e.batch_id', 'b.id')
        .innerJoin('claims as c', 'c.id', 'e.claim_id')
        .select(['e.claim_id', 'e.coverage_id', 'c.number'])
        .distinct()
        .where('b.tenant_id', '=', tenantId)
        .where('b.control_number', '=', number)
        .where('e.kind', 'in', SUBMISSIONS)
        .execute();
};

export const insertAcknowledgment = async (
  db: Db,
  a: {
    claimId: string;
    coverageId: string;
    kind: 'accepted' | 'rejected';
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

export const findTracedCoverage = (db: Db, tenantId: string, trace: string) =>
  db
    .selectFrom('claim_coverages')
    .select(['id', 'claim_id'])
    .where('tenant_id', '=', tenantId)
    .where(sql<string>`id::text`, '=', trace.toLowerCase())
    .executeTakeFirst();

export const saveEligibility = (
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
  tenantId: string;
  userId: string | null;
  digest: string;
  fileName: string;
  now: Date;
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

const postRemittances = async (c: Context, remittances: Remittance[]) => {
  const items: FileItem[] = [];
  let n = 0;
  for (const remit of remittances) {
    for (const rc of remit.claims) {
      n += 1;
      const claim = await findClaimByNumber(c.tx, c.tenantId, rc.claimNumber);
      if (!claim) {
        items.push(noClaim(rc.claimNumber));
        continue;
      }
      const posting = remittancePosting(rc);
      if (!posting.post) {
        items.push(item(rc.claimNumber, claim.id, 'review', posting.reason));
        continue;
      }
      const coverage = remittanceCoverage(
        await listPostingCoverages(c.tx, claim.id),
        remit.payerId,
        rc.status
      );
      if (!coverage) {
        items.push(
          item(
            rc.claimNumber,
            claim.id,
            'review',
            `${remit.payerName ?? 'The payer'} is not a payer on this claim; post the payment by hand`
          )
        );
        continue;
      }
      const posted = await postClaimResponse(c.tx, c.boss, c.tenantId, claim.id, c.userId, {
        requestId: `${c.digest}:${n}`,
        kind: 'response',
        coverageId: coverage.id,
        paidCents: posting.paidCents,
        adjustedCents: posting.adjustedCents,
        paidOn: remit.paidOn,
        checkNumber: remit.checkNumber,
        payerClaimNumber: posting.payerClaimNumber,
        adjustments: posting.adjustments,
        note: `${rc.denied ? 'Denied' : 'Remittance'} from ${remit.payerName ?? 'the payer'} in ${c.fileName}`
      });
      items.push(
        posted.ok
          ? item(
              rc.claimNumber,
              claim.id,
              posted.value.duplicate ? 'duplicate' : 'posted',
              rc.denied ? 'Denied' : '',
              posting
            )
          : item(rc.claimNumber, claim.id, 'review', posted.failure.message)
      );
    }
  }
  return items;
};

const acknowledge = async (
  c: Context,
  claimId: string,
  coverageId: string,
  a: { accepted: boolean; note: string; payerClaimNumber: string | null; key: string }
) => {
  await insertAcknowledgment(c.tx, {
    claimId,
    coverageId,
    kind: a.accepted ? 'accepted' : 'rejected',
    note: a.note,
    payerClaimNumber: a.payerClaimNumber,
    sourceKey: `${c.digest}:${a.key}`,
    createdBy: c.userId
  });
  await nudgeClaim(c.tx, c.boss, c.tenantId, claimId);
};

const postBatchAcknowledgments = async (c: Context, groups: GroupAcknowledgment[]) => {
  const items: FileItem[] = [];
  for (const group of groups) {
    const claims = await findBatchClaims(c.tx, c.tenantId, group.groupControlNumber);
    if (!claims.length) {
      items.push(
        item(
          group.groupControlNumber,
          null,
          'unmatched',
          `No 837P file has control number ${group.groupControlNumber}`
        )
      );
      continue;
    }
    const errors = group.transactions.flatMap((t) => t.errors);
    const accepted = group.accepted && group.transactions.every((t) => t.accepted);
    const note = accepted
      ? `The clearinghouse accepted 837P file ${group.groupControlNumber}`
      : `The clearinghouse rejected 837P file ${group.groupControlNumber}${errors.length ? `: ${errors.join('; ')}` : ''}`;
    for (const claim of claims) {
      if (claim.coverage_id === null) continue;
      await acknowledge(c, claim.claim_id, claim.coverage_id, {
        accepted,
        note,
        payerClaimNumber: null,
        key: `${group.groupControlNumber}:${claim.claim_id}`
      });
      items.push(
        item(String(claim.number), claim.claim_id, accepted ? 'accepted' : 'rejected', note)
      );
    }
  }
  return items;
};

const postClaimAcknowledgments = async (c: Context, acks: ClaimAcknowledgment[]) => {
  const items: FileItem[] = [];
  let n = 0;
  for (const ack of acks) {
    n += 1;
    const claim = await findClaimByNumber(c.tx, c.tenantId, ack.claimNumber);
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
            ? 'The claim has not been submitted from here'
            : `Pending: ${ack.message || ack.categories.join(', ')}`
        )
      );
      continue;
    }
    const accepted = ack.status === 'accepted';
    const note = `${accepted ? 'Accepted' : 'Rejected'} (${ack.categories.join(', ')})${ack.message ? `: ${ack.message}` : ''}`;
    await acknowledge(c, claim.id, coverageId, {
      accepted,
      note,
      payerClaimNumber: ack.payerClaimNumber,
      key: String(n)
    });
    items.push(item(ack.claimNumber, claim.id, accepted ? 'accepted' : 'rejected', note));
  }
  return items;
};

const postEligibility = async (c: Context, results: EligibilityResult[]) => {
  const items: FileItem[] = [];
  for (const r of results) {
    const coverage = await findTracedCoverage(c.tx, c.tenantId, r.trace);
    if (!coverage) {
      items.push(item(r.trace, null, 'unmatched', 'No payer on a claim matches this response'));
      continue;
    }
    const note = [
      r.planName,
      r.coverageStart || r.coverageEnd
        ? `Covered ${r.coverageStart ?? '?'} to ${r.coverageEnd ?? 'now'}`
        : null,
      ...r.messages
    ]
      .filter(Boolean)
      .join('; ');
    if (r.active === null) {
      items.push(item(r.trace, coverage.claim_id, 'review', note || 'The payer did not say'));
      continue;
    }
    await saveEligibility(c.tx, coverage.id, { active: r.active, note, checkedAt: c.now });
    await nudgeClaim(c.tx, c.boss, c.tenantId, coverage.claim_id);
    items.push(item(r.trace, coverage.claim_id, r.active ? 'eligible' : 'ineligible', note));
  }
  return items;
};

const PROCESSORS: Record<InboundKind, (c: Context, text: string) => Promise<FileItem[]>> = {
  '835': (c, text) => postRemittances(c, read835(text)),
  '999': (c, text) => postBatchAcknowledgments(c, read999(text)),
  '277': (c, text) => postClaimAcknowledgments(c, read277(text)),
  '271': (c, text) => postEligibility(c, read271(text))
};

const kindOf = (text: string) => {
  try {
    return readX12(text);
  } catch {
    return null;
  }
};

export type InboundFile = {
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
      'This is not a remittance (835), acknowledgment (999 or 277CA) or eligibility (271) file'
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
    tenantId: string;
    userId: string | null;
    fileName: string;
    document: unknown;
    file: InboundFile;
    now: Date;
  }
) => {
  const { id } = await insertPayerFile(tx, {
    tenantId: f.tenantId,
    kind: f.file.kind,
    fileName: f.fileName,
    digest: f.file.digest,
    document: f.document,
    controlNumber: f.file.controlNumber,
    uploadedBy: f.userId
  });
  const items = await PROCESSORS[f.file.kind](
    {
      tx,
      boss,
      tenantId: f.tenantId,
      userId: f.userId,
      digest: f.file.digest,
      fileName: f.fileName,
      now: f.now
    },
    f.file.text
  );
  const problems = items.filter((i) => PROBLEM_OUTCOMES.includes(i.outcome)).length;
  await saveFileItems(tx, id, items, problems);
  return { id, kind: f.file.kind, items, problems };
};
