import type { DocumentKind } from '@ugula/billing';
import type { Db } from '@ugula/db';
import type { BlobRef } from '@ugula/storage';

export const listClaimDocuments = (db: Db, claimId: string) =>
  db
    .selectFrom('claim_documents as d')
    .leftJoin('users as u', 'u.id', 'd.uploaded_by')
    .select([
      'd.id',
      'd.kind',
      'd.file_name',
      'd.signed_on',
      'd.created_at',
      'u.email as uploaded_by_email'
    ])
    .where('d.claim_id', '=', claimId)
    .orderBy('d.created_at')
    .orderBy('d.id')
    .execute();

export const findClaimDocument = async (
  db: Db,
  agencyId: string,
  claimId: string,
  documentId: string
) =>
  (await db
    .selectFrom('claim_documents')
    .select(['document', 'file_name'])
    .where('id', '=', documentId)
    .where('claim_id', '=', claimId)
    .where('agency_id', '=', agencyId)
    .executeTakeFirst()) ?? null;

type NewDocument = {
  agencyId: string;
  claimId: string;
  kind: DocumentKind;
  fileName: string;
  document: BlobRef;
  signedOn: string | null;
  uploadedBy: string;
};

export const insertClaimDocument = (db: Db, d: NewDocument) =>
  db
    .insertInto('claim_documents')
    .values({
      agency_id: d.agencyId,
      claim_id: d.claimId,
      kind: d.kind,
      file_name: d.fileName,
      document: JSON.stringify(d.document),
      signed_on: d.signedOn,
      uploaded_by: d.uploadedBy
    })
    .returning('id')
    .executeTakeFirstOrThrow();

export const insertDocumentEvent = (db: Db, claimId: string, note: string, createdBy: string) =>
  db
    .insertInto('claim_events')
    .values({ claim_id: claimId, kind: 'document', note, created_by: createdBy })
    .execute();
