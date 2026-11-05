import { BUILT_IN_ROLES, isPermission, PERMISSIONS, type Permission } from '@ugula/access';
import { sql } from 'kysely';
import type { Db } from './schema.ts';

export type AgencyAccess = {
  agencyId: string;
  agencyName: string;
  organizationId: string;
  organizationName: string;
  userId: string;
  isOrganizationAdmin: boolean;
  permissions: Permission[];
};

export const rolePermissionsSql = (role: string) => sql<string[]>`coalesce((
  select array_agg(rp.permission order by rp.permission)
  from role_permissions rp where rp.role_id = ${sql.ref(role)}
), '{}')`;

export const permissionsOf = (row: { permissions: string[] }): Permission[] =>
  row.permissions.filter(isPermission);

const reachableAgencies = (db: Db, userId: string) =>
  db
    .selectFrom('users as u')
    .innerJoin('agencies as a', (j) =>
      j.on((eb) =>
        eb.or([
          eb('u.type', '=', 'platform'),
          eb('a.organization_id', '=', eb.ref('u.organization_id'))
        ])
      )
    )
    .innerJoin('organizations as o', 'o.id', 'a.organization_id')
    .leftJoin('memberships as m', (j) =>
      j.onRef('m.agency_id', '=', 'a.id').onRef('m.user_id', '=', 'u.id')
    )
    .where('u.id', '=', userId)
    .where('u.is_active', '=', true)
    .where('a.is_active', '=', true)
    .where('o.is_active', '=', true)
    .where((eb) =>
      eb.or([
        eb('u.type', '=', 'platform'),
        eb('u.is_owner', '=', true),
        eb('m.id', 'is not', null)
      ])
    );

const accessRows = (db: Db, userId: string) =>
  reachableAgencies(db, userId).select([
    'a.id as agency_id',
    'a.name as agency_name',
    'o.id as organization_id',
    'o.name as organization_name',
    sql<boolean>`u.type = 'platform' or u.is_owner`.as('is_full'),
    rolePermissionsSql('m.role_id').as('permissions')
  ]);

export const findAgencyAccess = async (
  db: Db,
  userId: string,
  agencyId: string
): Promise<AgencyAccess | null> => {
  const row = await accessRows(db, userId).where('a.id', '=', agencyId).executeTakeFirst();
  return row
    ? {
        agencyId: row.agency_id,
        agencyName: row.agency_name,
        organizationId: row.organization_id,
        organizationName: row.organization_name,
        userId,
        isOrganizationAdmin: row.is_full,
        permissions: row.is_full ? [...PERMISSIONS] : permissionsOf(row)
      }
    : null;
};

export const listAccessibleAgencies = async (db: Db, userId: string) =>
  (await accessRows(db, userId).orderBy('o.name').orderBy('a.name').execute()).map((r) => ({
    id: r.agency_id,
    name: r.agency_name,
    organizationId: r.organization_id,
    organizationName: r.organization_name
  }));

export const canOpenAgency = async (db: Db, userId: string, agencyId: string) =>
  (await reachableAgencies(db, userId)
    .select('a.id')
    .where('a.id', '=', agencyId)
    .executeTakeFirst()) !== undefined;

const BUILT_IN = new Map(BUILT_IN_ROLES.map((r) => [r.name, r.permissions]));

export const saveBuiltInRoles = async (db: Db, agencyId: string) => {
  const roles = await db
    .insertInto('roles')
    .values(BUILT_IN_ROLES.map((r) => ({ agency_id: agencyId, name: r.name })))
    .onConflict((oc) => oc.columns(['agency_id', 'name']).doUpdateSet({ updated_at: sql`now()` }))
    .returning(['id', 'name'])
    .execute();
  const ids = roles.map((r) => r.id);
  await db.deleteFrom('role_permissions').where('role_id', 'in', ids).execute();
  await db
    .insertInto('role_permissions')
    .values(
      roles.flatMap((r) =>
        (BUILT_IN.get(r.name) ?? []).map((permission) => ({ role_id: r.id, permission }))
      )
    )
    .execute();
  return new Map(roles.map((r) => [r.name, r.id]));
};
