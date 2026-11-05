import {
  type AppliedPayerFile,
  type BlobRef,
  type PayerFileStore,
  REVIEW_OUTCOMES,
  type RemittancePosting
} from '@ugula/billing';
import {
  applyPayerFile,
  type Db,
  findImported,
  findReviewLines,
  readPayerFile,
  readRemittanceLines
} from '@ugula/db';
import type { RunQueueClient } from '@ugula/run-queue';
import type { BlobStore } from '@ugula/storage';
import type { Announce } from '../../shared/live.ts';

type Blobs = Pick<BlobStore, 'getBytes'>;

export type ApplyDocument = (
  runId: string,
  sourceKey: string,
  document: BlobRef,
  fileName: string,
  postings?: readonly RemittancePosting[]
) => Promise<AppliedPayerFile>;

export const createPayerFileStore = (
  db: Db,
  blobs: Blobs,
  boss: RunQueueClient,
  announce: Announce,
  now: () => Date = () => new Date()
): PayerFileStore & { applyDocument: ApplyDocument } => {
  const load = async (runId: string, document: BlobRef) => {
    const run = await db
      .selectFrom('workflow_runs')
      .select(['agency_id', 'started_by'])
      .where('id', '=', runId)
      .executeTakeFirstOrThrow();
    const read = readPayerFile(await blobs.getBytes(document));
    const userId = run.started_by;
    if (!read.ok) return { agencyId: run.agency_id, userId, read } as const;
    const imported = await findImported(db, run.agency_id, read.value.digest);
    return { agencyId: run.agency_id, userId, read, imported } as const;
  };

  const applyDocument: ApplyDocument = async (
    runId,
    sourceKey,
    document,
    fileName,
    postings = []
  ) => {
    const loaded = await load(runId, document);
    if (!loaded.read.ok) return { status: 'unreadable', reason: loaded.read.failure.message };
    const { imported } = loaded;
    if (imported && imported.source_key !== sourceKey) {
      return { status: 'duplicate', fileId: imported.id };
    }
    if (imported) {
      return {
        status: 'applied',
        fileId: imported.id,
        kind: imported.kind,
        envelopeRejection: imported.envelope_rejection,
        reviews: await findReviewLines(db, imported.id)
      };
    }
    const file = loaded.read.value;
    const applied = await db.transaction().execute((tx) =>
      applyPayerFile(tx, boss, {
        agencyId: loaded.agencyId,
        userId: loaded.userId,
        runId,
        sourceKey,
        fileName,
        document,
        file,
        now: now(),
        postings
      })
    );
    const touched = new Set(applied.items.flatMap((i) => (i.claimId ? [i.claimId] : [])));
    for (const id of touched) await announce(runId, { kind: 'claim', id });
    await announce(runId, { kind: 'payerFile', id: applied.id });
    return {
      status: 'applied',
      fileId: applied.id,
      kind: applied.kind,
      envelopeRejection: applied.envelopeRejection,
      reviews: applied.items
        .filter((i) => REVIEW_OUTCOMES.includes(i.outcome))
        .map(({ reference, claimId, outcome, message }) => ({
          reference,
          claimId,
          outcome,
          message
        }))
    };
  };

  return {
    read: async (runId, { document }) => {
      const loaded = await load(runId, document);
      if (!loaded.read.ok) return { status: 'unreadable', reason: loaded.read.failure.message };
      if (loaded.imported && loaded.imported.run_id !== runId) {
        return { status: 'duplicate', fileId: loaded.imported.id };
      }
      const { kind, text } = loaded.read.value;
      return {
        status: 'read',
        kind,
        lines: kind === '835' ? await readRemittanceLines(db, loaded.agencyId, text) : []
      };
    },
    apply: (runId, sourceKey, { document, fileName, postings }) =>
      applyDocument(runId, sourceKey, document, fileName, postings),
    applyDocument
  };
};
