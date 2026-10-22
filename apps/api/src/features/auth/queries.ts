import type { Db } from '@ugula/db';

export type AuthUserRecord = {
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
    .where('users.email', '=', email)
    .where('users.is_active', '=', true)
    .where('tenants.is_active', '=', true)
    .executeTakeFirst();
