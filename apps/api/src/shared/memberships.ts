import { isPermission, isUserAdmin, type Permission } from '@ugula/access';
import type { Db } from '@ugula/db';
import { sql } from 'kysely';

export const rolePermissionsSql = (role: string) => sql<string[]>`coalesce((
  select array_agg(rp.permission order by rp.permission)
  from role_permissions rp where rp.role_id = ${sql.ref(role)}
), '{}')`;

export const permissionsOf = (row: { permissions: string[] }): Permission[] =>
  row.permissions.filter(isPermission);

export const lockMemberships = async (db: Db, agencyId: string) => {
  await db
    .selectFrom('agencies')
    .select('id')
    .where('id', '=', agencyId)
    .forNoKeyUpdate()
    .execute();
};

export const hasUserAdmin = async (
  db: Db,
  agencyId: string,
  except: { roleId?: string; userId?: string }
) => {
  let q = db
    .selectFrom('memberships as m')
    .select(rolePermissionsSql('m.role_id').as('permissions'))
    .where('m.agency_id', '=', agencyId);
  if (except.roleId) q = q.where('m.role_id', '!=', except.roleId);
  if (except.userId) q = q.where('m.user_id', '!=', except.userId);
  return (await q.execute()).some((r) => isUserAdmin(permissionsOf(r)));
};
