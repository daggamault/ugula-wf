import { createHash } from 'node:crypto';
import {
  type ClaimAcknowledgment,
  type EligibilityResult,
  type GroupAcknowledgment,
  type InboundKind,
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
import type { Db } from '@ugula/db';
import type { RunQueueClient } from '@ugula/run-queue';
import type { BlobRef, BlobStore } from '@ugula/storage';
import { nudgeClaim, postClaimResponse } from '../../shared/claim-responses.ts';
import { safeName, type UploadedFile, uploadKey } from '../../shared/files.ts';
import { type Announce, announced } from '../../shared/live.ts';
import type { PageRequest } from '../../shared/paging.ts';
import { fail, ok } from '../../shared/result.ts';
import {
  type FileItem,
  findBatchClaims,
  findClaimByNumber,
  findImported,
  findPayerFile,
  findTracedCoverage,
  insertAcknowledgment,
  insertPayerFile,
  lastSubmittedCoverage,
  listFileItems,
  listPayerFiles,
  listPostingCoverages,
  saveEligibility,
  saveFileItems
} from './queries.ts';
import type { PayerFileSort } from './schemas.ts';

type PayerFileServiceDeps = {
  db: Db;
  boss: RunQueueClient;
  blobs: Pick<BlobStore, 'putBytes' | 'getBytes'>;
  announce: Announce;
  now: () => Date;
  maxBytes: number;
};

type Context = {
  tx: Db;
  boss: RunQueueClient;
  tenantId: string;
  userId: string;
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

export const createPayerFileService = ({
  db,
  boss,
  blobs,
  announce,
  now,
  maxBytes
}: PayerFileServiceDeps) => ({
  list: async (tenantId: string, page: PageRequest<PayerFileSort>) =>
    ok(await listPayerFiles(db, tenantId, page)),

  find: async (tenantId: string, id: string) => {
    const file = await findPayerFile(db, tenantId, id);
    if (!file) return fail('not_found', 'Payer file not found');
    const { document: _, ...meta } = file;
    return ok({ file: meta, items: await listFileItems(db, id) });
  },

  download: async (tenantId: string, id: string) => {
    const file = await findPayerFile(db, tenantId, id);
    if (!file) return fail('not_found', 'Payer file not found');
    return ok({ name: file.file_name, bytes: await blobs.getBytes(file.document as BlobRef) });
  },

  upload: async (tenantId: string, userId: string, file: UploadedFile) => {
    if (!file.bytes.byteLength) return fail('invalid', 'The file is empty');
    if (file.bytes.byteLength > maxBytes) {
      return fail('invalid', `The file is larger than ${maxBytes} bytes`);
    }
    const text = new TextDecoder().decode(file.bytes);
    const x12 = kindOf(text);
    if (!x12?.kind) {
      return fail(
        'invalid',
        'This is not a remittance (835), acknowledgment (999 or 277CA) or eligibility (271) file'
      );
    }
    const kind = x12.kind;
    const digest = createHash('sha256').update(file.bytes).digest('hex');
    const imported = await findImported(db, tenantId, digest);
    if (imported) {
      return fail(
        'conflict',
        `This file was already imported on ${imported.created_at.toISOString().slice(0, 10)}`,
        { id: imported.id }
      );
    }
    const fileName = file.name.trim() || safeName(file.name);
    const document = await blobs.putBytes(
      uploadKey(tenantId, fileName, 'payer-files/'),
      file.bytes,
      'application/edi-x12'
    );
    const touched: string[] = [];
    const saved = db.transaction().execute(async (tx) => {
      const { id } = await insertPayerFile(tx, {
        tenantId,
        kind,
        fileName,
        digest,
        document,
        controlNumber: x12.controlNumber,
        uploadedBy: userId
      });
      const items = await PROCESSORS[kind](
        { tx, boss, tenantId, userId, digest, fileName, now: now() },
        text
      );
      const problems = items.filter((i) => PROBLEM_OUTCOMES.includes(i.outcome)).length;
      await saveFileItems(tx, id, items, problems);
      touched.push(...new Set(items.flatMap((i) => (i.claimId ? [i.claimId] : []))));
      return ok({ id, kind, items: items.length, problems });
    });
    return announced(announce, tenantId, saved, () =>
      touched.map((id) => ({ kind: 'claim' as const, id }))
    );
  }
});

export type PayerFileService = ReturnType<typeof createPayerFileService>;
