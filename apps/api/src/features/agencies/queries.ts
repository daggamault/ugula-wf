import { isPermission, PERMISSIONS, type Permission } from '@ugula/access';
import type { Db } from '@ugula/db';
import { sql } from 'kysely';

type AgencyRow = {
  agency_id: string;
  agency_name: string;
  organization_id: string;
  organization_name: string;
  is_full: boolean;
  permissions: string[] | null;
};

const buildAccessibleAgencies = (db: Db, userId: string) =>
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
    .select([
      'a.id as agency_id',
      'a.name as agency_name',
      'o.id as organization_id',
      'o.name as organization_name',
      sql<boolean>`u.type = 'platform' or u.is_owner`.as('is_full'),
      sql<string[] | null>`(
        select array_agg(rp.permission order by rp.permission)
        from role_permissions rp where rp.role_id = m.role_id
      )`.as('permissions')
    ])
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

const permissionsOf = (row: AgencyRow): Permission[] =>
  row.is_full ? [...PERMISSIONS] : (row.permissions ?? []).filter(isPermission);

const toAccess = (userId: string, row: AgencyRow) => ({
  agencyId: row.agency_id,
  agencyName: row.agency_name,
  organizationId: row.organization_id,
  organizationName: row.organization_name,
  userId,
  isOrganizationAdmin: row.is_full,
  permissions: permissionsOf(row)
});

export const findAgencyAccess = async (db: Db, userId: string, agencyId: string) => {
  const row = await buildAccessibleAgencies(db, userId)
    .where('a.id', '=', agencyId)
    .executeTakeFirst();
  return row ? toAccess(userId, row) : null;
};

export const listAccessibleAgencies = async (db: Db, userId: string) =>
  (await buildAccessibleAgencies(db, userId).orderBy('o.name').orderBy('a.name').execute()).map(
    (r) => ({
      id: r.agency_id,
      name: r.agency_name,
      organizationId: r.organization_id,
      organizationName: r.organization_name
    })
  );
