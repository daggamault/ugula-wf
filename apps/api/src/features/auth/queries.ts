import type { Db } from '@ugula/db';
import { sql } from 'kysely';

type AuthUserRecord = {
  id: string;
  agency_id: string;
  email: string;
  password_hash: string;
};

export const findActiveUserByEmail = (db: Db, email: string): Promise<AuthUserRecord | undefined> =>
  db
    .selectFrom('users')
    .innerJoin('agencies', 'agencies.id', 'users.agency_id')
    .select(['users.id', 'users.agency_id', 'users.email', 'users.password_hash'])
    .where(sql`lower(users.email)`, '=', email.toLowerCase())
    .where('users.is_active', '=', true)
    .where('agencies.is_active', '=', true)
    .executeTakeFirst();

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
