import { createHash } from 'node:crypto';
import {
  type ClaimTaskStore,
  DOCUMENT_KINDS,
  documentContentTypeOf,
  isClosedStatus
} from '@ugula/billing';
import { type Db, type Failure, lockClaim, postClaimResponse, setClaimPayers } from '@ugula/db';
import type { RunQueueClient } from '@ugula/run-queue';
import { type BlobStore, importsPrefix } from '@ugula/storage';
import { sql } from 'kysely';
import { isUuid } from '../../shared/ids.ts';
import { agencyClaim } from './claim-scope.ts';

type Blobs = Pick<BlobStore, 'getBytes' | 'putBytes'>;

const refused = (reason: string) => ({ status: 'refused', reason }) as const;

const refusedBy = (f: Failure) => refused(f.message);

const userOf = (id: string | null) => (id && isUuid(id) ? id : null);

export const uploadsOf = (agencyId: string) => `${importsPrefix(agencyId)}uploads/`;

export const documentKey = (agencyId: string, claimId: string, sourceKey: string, name: string) =>
  `documents/${agencyId}/${claimId}/${createHash('sha256').update(sourceKey).digest('hex').slice(0, 16)}/${name}`;

export const createClaimTaskStore = (
  db: Db,
  blobs: Blobs,
  boss: RunQueueClient
): ClaimTaskStore => ({
  setPayers: async (runId, claimId, payers) => {
    const claim = await agencyClaim(db, runId, claimId);
    const set = await db
      .transaction()
      .execute((tx) => setClaimPayers(tx, boss, claim.agency_id, claim.id, payers));
    return set.ok ? { status: 'saved' } : refusedBy(set.failure);
  },

  postPayment: async (runId, claimId, sourceKey, payment, postedBy) => {
    const claim = await agencyClaim(db, runId, claimId);
    const posted = await db.transaction().execute((tx) =>
      postClaimResponse(tx, boss, claim.agency_id, claim.id, userOf(postedBy), {
        ...payment,
        requestId: sourceKey
      })
    );
    return posted.ok
      ? { status: 'posted', balanceCents: posted.value.balanceCents }
      : refusedBy(posted.failure);
  },

  addDocument: async (runId, claimId, sourceKey, d) => {
    const claim = await agencyClaim(db, runId, claimId);
    const { key } = d.file;
    if (!key.startsWith(uploadsOf(claim.agency_id)) || key.split('/').includes('..')) {
      throw new Error(`Blob ${key} is not one of this agency's uploads`);
    }
    const bytes = await blobs.getBytes(d.file);
    const contentType = documentContentTypeOf(bytes);
    if (!contentType) return refused('Upload the document as a PDF, PNG, JPEG or TIFF file');
    const fileName = key.split('/').at(-1) || 'document';
    const document = await blobs.putBytes(
      documentKey(claim.agency_id, claim.id, sourceKey, fileName),
      bytes,
      contentType
    );
    const addedBy = userOf(d.addedBy);
    return db.transaction().execute(async (tx) => {
      const locked = await lockClaim(tx, claim.agency_id, claim.id);
      if (!locked || isClosedStatus(locked.status)) return refused('Claim is already closed');
      const kept = await tx
        .selectFrom('claim_documents')
        .select('id')
        .where('claim_id', '=', claim.id)
        .where(sql<string>`document ->> 'key'`, '=', document.key)
        .executeTakeFirst();
      const { id } =
        kept ??
        (await tx
          .insertInto('claim_documents')
          .values({
            agency_id: claim.agency_id,
            claim_id: claim.id,
            kind: d.kind,
            file_name: fileName,
            document: JSON.stringify(document),
            signed_on: d.signedOn,
            uploaded_by: addedBy
          })
          .returning('id')
          .executeTakeFirstOrThrow());
      await tx
        .insertInto('claim_events')
        .values({
          claim_id: claim.id,
          kind: 'document',
          note: `${DOCUMENT_KINDS[d.kind]} uploaded: ${fileName}`,
          created_by: addedBy,
          source_key: sourceKey
        })
        .onConflict((oc) => oc.columns(['claim_id', 'source_key']).doNothing())
        .execute();
      return { status: 'added', documentId: id };
    });
  }
});
