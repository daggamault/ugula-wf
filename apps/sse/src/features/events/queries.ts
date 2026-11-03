import type { Db } from '@ugula/db';

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
