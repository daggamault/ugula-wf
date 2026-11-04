import type { Db } from '@ugula/db';

export const isActiveMember = async (db: Db, userId: string, agencyId: string) =>
  (await db
    .selectFrom('users')
    .innerJoin('agencies', 'agencies.id', 'users.agency_id')
    .select('users.id')
    .where('users.id', '=', userId)
    .where('users.agency_id', '=', agencyId)
    .where('users.is_active', '=', true)
    .where('agencies.is_active', '=', true)
    .executeTakeFirst()) !== undefined;
