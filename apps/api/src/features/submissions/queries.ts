import type { Db } from '@ugula/db';

export const findBatchDocument = async (db: Db, agencyId: string, id: string) =>
  (await db
    .selectFrom('claim_batches')
    .select(['document', 'control_number'])
    .where('agency_id', '=', agencyId)
    .where('id', '=', id)
    .executeTakeFirst()) ?? null;
