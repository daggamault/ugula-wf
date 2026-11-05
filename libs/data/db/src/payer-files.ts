import { createHash } from 'node:crypto';
import {
  type InboundKind,
  PROBLEM_OUTCOMES,
  type RemittancePosting,
  read271,
  read277,
  read835,
  read999,
  readClaimStatus,
  readTA1,
  readX12
} from '@ugula/billing';
import type { RunQueueClient } from '@ugula/run-queue';
import {
  postBatchAcknowledgments,
  postClaimAcknowledgments,
  postClaimStatuses,
  postInterchangeAcknowledgments
} from './payer-file-acknowledgments.ts';
import { postEligibility } from './payer-file-eligibility.ts';
import type { Context, FileItem, Posted } from './payer-file-items.ts';
import { postRemittances } from './payer-file-remittances.ts';
import { fail, ok, type Result } from './result.ts';
import type { Db } from './schema.ts';

export { readRemittanceLines } from './payer-file-remittances.ts';

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

const saveFileItems = async (
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
