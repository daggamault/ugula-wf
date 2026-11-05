import { randomUUID } from 'node:crypto';
import { type ClaimStore, type Clearinghouse, exchangeFileName } from '@ugula/billing';
import {
  allocateControlNumber,
  batchKey,
  type Db,
  findProfile,
  findReadyClaim,
  insertBatch,
  insertSubmissionEvent,
  lockReadyClaim,
  markSubmitted,
  pendingClaim,
  toSubmitter
} from '@ugula/db';
import type { BlobRef, BlobStore } from '@ugula/storage';
import { sql } from 'kysely';
import { isUuid } from '../../shared/ids.ts';
import { runAgency } from '../../shared/tenancy.ts';
import { agencyClaim } from './claim-scope.ts';

const BATCH_CONTENT_TYPE = 'application/edi-x12';

export const createSubmissionStore = (
  db: Db,
  blobs: Pick<BlobStore, 'putBytes' | 'getBytes'>,
  readLedger: ClaimStore['ledger'],
  clearinghouseFor: (agencyId: string) => Promise<Clearinghouse | null>
): Pick<ClaimStore, 'submission' | 'saveSubmission' | 'sendClaimFile'> => ({
  submission: async (runId, claimId, coverageId) => {
    const run = await runAgency(db, runId).executeTakeFirst();
    if (!run || !isUuid(claimId)) throw new Error(`Claim ${claimId} does not exist`);
    const [profile, row, ledger] = await Promise.all([
      findProfile(db, run.agency_id),
      findReadyClaim(db, run.agency_id, claimId),
      readLedger(runId, claimId)
    ]);
    return {
      submitter: profile ? toSubmitter(profile) : null,
      pending: row && ledger ? pendingClaim(row, ledger.events, coverageId) : null
    };
  },

  saveSubmission: (runId, claimId, sourceKey, file) =>
    db.transaction().execute(async (tx) => {
      const claim = await agencyClaim(tx, runId, claimId);
      const filed = await tx
        .selectFrom('claim_events as e')
        .innerJoin('claim_batches as b', 'b.id', 'e.batch_id')
        .select('b.control_number')
        .where('e.claim_id', '=', claim.id)
        .where('e.source_key', '=', sourceKey)
        .executeTakeFirst();
      if (filed) return { controlNumber: filed.control_number };
      const locked = await lockReadyClaim(tx, claim.agency_id, claim.id);
      if (!locked) return 'stale';
      const controlNumber = await allocateControlNumber(tx, claim.agency_id);
      if (controlNumber === null) return 'exhausted';
      const id = randomUUID();
      const document = await blobs.putBytes(
        batchKey(claim.agency_id, id, controlNumber),
        new TextEncoder().encode(file.build(controlNumber)),
        BATCH_CONTENT_TYPE
      );
      await insertBatch(tx, {
        id,
        agencyId: claim.agency_id,
        controlNumber,
        totalCents: file.totalCents,
        production: file.production,
        document,
        createdBy: null
      });
      await insertSubmissionEvent(
        tx,
        { batchId: id, note: `837P file #${controlNumber}`, createdBy: null, sourceKey },
        {
          claimId: claim.id,
          kind: file.resubmission ? 'resubmitted' : 'submitted',
          coverageId: file.coverageId
        }
      );
      await markSubmitted(tx, claim.id);
      return { controlNumber };
    }),

  sendClaimFile: async (runId, claimId, controlNumber) => {
    const claim = await agencyClaim(db, runId, claimId);
    const batch = await db
      .selectFrom('claim_batches')
      .select(['id', 'document', 'sent_as'])
      .where('agency_id', '=', claim.agency_id)
      .where('control_number', '=', controlNumber)
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('claim_events as e')
            .select('e.id')
            .whereRef('e.batch_id', '=', 'claim_batches.id')
            .where('e.claim_id', '=', claimId)
        )
      )
      .executeTakeFirst();
    if (!batch) throw new Error(`No 837P file #${controlNumber} for claim ${claimId}`);
    if (batch.sent_as) return { sentAs: batch.sent_as };
    const clearinghouse = await clearinghouseFor(claim.agency_id);
    if (!clearinghouse) return 'manual';
    const name = await clearinghouse.submitClaims(
      exchangeFileName('claims', controlNumber, batch.id),
      await blobs.getBytes(batch.document as BlobRef)
    );
    await db
      .updateTable('claim_batches')
      .set({ sent_at: sql`now()`, sent_as: name })
      .where('id', '=', batch.id)
      .where('sent_as', 'is', null)
      .execute();
    return { sentAs: name };
  }
});
