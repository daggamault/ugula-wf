import { type PayerFileStore, PROBLEM_OUTCOMES } from '@ugula/billing';
import { applyPayerFile, type Db, findImported, readPayerFile } from '@ugula/db';
import type { RunQueueClient } from '@ugula/run-queue';
import type { BlobStore } from '@ugula/storage';
import type { Announce } from '../../shared/live.ts';
import { runTenant } from '../../shared/tenancy.ts';

type Blobs = Pick<BlobStore, 'getBytes'>;

export const createPayerFileStore = (
  db: Db,
  blobs: Blobs,
  boss: RunQueueClient,
  announce: Announce,
  now: () => Date = () => new Date()
): PayerFileStore => ({
  apply: async (runId, _sourceKey, { document, fileName }) => {
    const run = await runTenant(db, runId).executeTakeFirstOrThrow();
    const read = readPayerFile(await blobs.getBytes(document));
    if (!read.ok) return { status: 'unreadable', reason: read.failure.message };
    const imported = await findImported(db, run.tenant_id, read.value.digest);
    if (imported) return { status: 'duplicate', fileId: imported.id };
    const applied = await db.transaction().execute((tx) =>
      applyPayerFile(tx, boss, {
        tenantId: run.tenant_id,
        userId: null,
        fileName,
        document,
        file: read.value,
        now: now()
      })
    );
    const touched = new Set(applied.items.flatMap((i) => (i.claimId ? [i.claimId] : [])));
    for (const id of touched) await announce(runId, { kind: 'claim', id });
    return {
      status: 'applied',
      fileId: applied.id,
      kind: applied.kind,
      reviews: applied.items
        .filter((i) => PROBLEM_OUTCOMES.includes(i.outcome))
        .map(({ reference, claimId, outcome, message }) => ({
          reference,
          claimId,
          outcome,
          message
        }))
    };
  }
});
