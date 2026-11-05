import { USER_ADMIN_PERMISSIONS } from '@ugula/access';
import { type Db, rolePermissionsSql } from '@ugula/db';
import { sql } from 'kysely';

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
  let admins = db
    .selectFrom('memberships as m')
    .innerJoin('users as u', 'u.id', 'm.user_id')
    .select('m.id')
    .where('m.agency_id', '=', agencyId)
    .where('u.is_active', '=', true)
    .where(sql<boolean>`${rolePermissionsSql('m.role_id')} @> ${USER_ADMIN_PERMISSIONS}::text[]`);
  if (except.roleId) admins = admins.where('m.role_id', '!=', except.roleId);
  if (except.userId) admins = admins.where('m.user_id', '!=', except.userId);
  const found = await db
    .selectNoFrom((eb) => eb.exists(admins).as('found'))
    .executeTakeFirstOrThrow();
  return found.found;
};
