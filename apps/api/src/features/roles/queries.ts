import type { Permission } from '@ugula/access';
import { type Db, rolePermissionsSql } from '@ugula/db';
import { sql } from 'kysely';
import { type PageRequest, paged } from '../../shared/paging.ts';
import { containsPattern } from '../../shared/search.ts';
import type { RoleSort } from './schemas.ts';

export type RoleFilters = PageRequest<RoleSort> & { q?: string | undefined };

const roleRows = (db: Db, agencyId: string) =>
  db
    .selectFrom('roles as r')
    .select([
      'r.id',
      'r.name',
      'r.version',
      'r.updated_at',
      rolePermissionsSql('r.id').as('permissions'),
      sql<number>`(select count(*)::int from memberships m where m.role_id = r.id)`.as('users')
    ])
    .where('r.agency_id', '=', agencyId);

const ROLE_ORDER = {
  name: sql`lower(r.name)`,
  users: sql`(select count(*) from memberships m where m.role_id = r.id)`,
  updated: sql.ref('r.updated_at')
};

export type RoleRow = {
  id: string;
  name: string;
  version: number;
  updated_at: Date;
  permissions: string[];
  users: number;
};

export const searchRoles = (db: Db, agencyId: string, f: RoleFilters) => {
  let q = roleRows(db, agencyId);
  if (f.q) q = q.where(sql`lower(r.name)`, 'like', containsPattern(f.q));
  return paged(q, f, ROLE_ORDER, sql.ref('r.id'));
};

export const findRole = (db: Db, agencyId: string, id: string) =>
  roleRows(db, agencyId).where('r.id', '=', id).executeTakeFirst();

export const insertRole = (db: Db, agencyId: string, name: string) =>
  db
    .insertInto('roles')
    .values({ agency_id: agencyId, name })
    .returning('id')
    .executeTakeFirstOrThrow();

export const replacePermissions = async (db: Db, roleId: string, permissions: Permission[]) => {
  await db.deleteFrom('role_permissions').where('role_id', '=', roleId).execute();
  if (permissions.length) {
    await db
      .insertInto('role_permissions')
      .values(permissions.map((permission) => ({ role_id: roleId, permission })))
      .execute();
  }
};

export const updateRole = (
  db: Db,
  agencyId: string,
  id: string,
  input: { name: string; version: number }
) =>
  db
    .updateTable('roles')
    .set({ name: input.name, version: sql`version + 1`, updated_at: sql`now()` })
    .where('id', '=', id)
    .where('agency_id', '=', agencyId)
    .where('version', '=', input.version)
    .returning('id')
    .executeTakeFirst();

export const deleteRole = (db: Db, agencyId: string, id: string) =>
  db
    .deleteFrom('roles')
    .where('id', '=', id)
    .where('agency_id', '=', agencyId)
    .returning('id')
    .executeTakeFirst();
