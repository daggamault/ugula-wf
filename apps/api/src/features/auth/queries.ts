import type { Db } from '@ugula/db';
import { sql } from 'kysely';

type AuthUserRecord = {
  id: string;
  tenant_id: string;
  email: string;
  password_hash: string;
};

export const findActiveUserByEmail = (db: Db, email: string): Promise<AuthUserRecord | undefined> =>
  db
    .selectFrom('users')
    .innerJoin('tenants', 'tenants.id', 'users.tenant_id')
    .select(['users.id', 'users.tenant_id', 'users.email', 'users.password_hash'])
    .where(sql`lower(users.email)`, '=', email.toLowerCase())
    .where('users.is_active', '=', true)
    .where('tenants.is_active', '=', true)
    .executeTakeFirst();

export const isActiveMember = async (db: Db, userId: string, tenantId: string) =>
  (await db
    .selectFrom('users')
    .innerJoin('tenants', 'tenants.id', 'users.tenant_id')
    .select('users.id')
    .where('users.id', '=', userId)
    .where('users.tenant_id', '=', tenantId)
    .where('users.is_active', '=', true)
    .where('tenants.is_active', '=', true)
    .executeTakeFirst()) !== undefined;
