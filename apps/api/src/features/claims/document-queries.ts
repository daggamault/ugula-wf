import type { Db } from '@ugula/db';

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
