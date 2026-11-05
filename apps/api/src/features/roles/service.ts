import {
  canGrant,
  isUserAdmin,
  PERMISSION_DESCRIPTIONS,
  PERMISSIONS,
  type Permission
} from '@ugula/access';
import { type Db, permissionsOf } from '@ugula/db';
import type { AgencyAccess } from '../../shared/access.ts';
import { isForeignKeyViolation, isUniqueViolation } from '../../shared/http.ts';
import { hasUserAdmin, lockMemberships } from '../../shared/memberships.ts';
import { fail, ok } from '../../shared/result.ts';
import {
  deleteRole,
  findRole,
  insertRole,
  type RoleFilters,
  type RoleRow,
  replacePermissions,
  searchRoles,
  updateRole
} from './queries.ts';
import type { RoleInput } from './schemas.ts';

const notFound = fail('not_found', 'Role not found');

const ungrantable = fail('forbidden', "You can't grant permissions you don't hold");

const nameTaken = fail('conflict', 'A role with that name exists');

export const toRole = (row: RoleRow, held: readonly Permission[]) => {
  const permissions = permissionsOf(row);
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    users: row.users,
    permissions,
    isGrantable: canGrant(held, permissions),
    updatedAt: row.updated_at
  };
};

export const createRoleService = ({ db }: { db: Db }) => ({
  list: async (access: AgencyAccess, filters: RoleFilters) => {
    const page = await searchRoles(db, access.agencyId, filters);
    return ok({ ...page, items: page.items.map((r) => toRole(r, access.permissions)) });
  },
  find: async (access: AgencyAccess, id: string) => {
    const row = await findRole(db, access.agencyId, id);
    return row ? ok(toRole(row, access.permissions)) : notFound;
  },
  permissions: (access: AgencyAccess) =>
    ok({
      items: PERMISSIONS.map((permission) => ({
        permission,
        description: PERMISSION_DESCRIPTIONS[permission],
        isGrantable: access.permissions.includes(permission)
      }))
    }),
  create: async (access: AgencyAccess, input: RoleInput) => {
    if (!canGrant(access.permissions, input.permissions)) return ungrantable;
    try {
      return ok(
        await db.transaction().execute(async (tx) => {
          const { id } = await insertRole(tx, access.agencyId, input.name);
          await replacePermissions(tx, id, input.permissions);
          return { id };
        })
      );
    } catch (err) {
      if (isUniqueViolation(err)) return nameTaken;
      throw err;
    }
  },
  update: async (access: AgencyAccess, id: string, input: RoleInput & { version: number }) => {
    try {
      return await db.transaction().execute(async (tx) => {
        await lockMemberships(tx, access.agencyId);
        const row = await findRole(tx, access.agencyId, id);
        if (!row) return notFound;
        const before = permissionsOf(row);
        if (
          !canGrant(access.permissions, before) ||
          !canGrant(access.permissions, input.permissions)
        ) {
          return ungrantable;
        }
        if (
          row.users > 0 &&
          isUserAdmin(before) &&
          !isUserAdmin(input.permissions) &&
          !(await hasUserAdmin(tx, access.agencyId, { roleId: id }))
        ) {
          return fail('conflict', 'The agency needs at least one user who can manage users');
        }
        if (!(await updateRole(tx, access.agencyId, id, input))) {
          return fail('conflict', 'Someone else changed this role; reload it and try again');
        }
        await replacePermissions(tx, id, input.permissions);
        const saved = await findRole(tx, access.agencyId, id);
        return saved ? ok(toRole(saved, access.permissions)) : notFound;
      });
    } catch (err) {
      if (isUniqueViolation(err)) return nameTaken;
      throw err;
    }
  },
  remove: async (access: AgencyAccess, id: string) => {
    const row = await findRole(db, access.agencyId, id);
    if (!row) return notFound;
    if (!canGrant(access.permissions, permissionsOf(row))) return ungrantable;
    try {
      return (await deleteRole(db, access.agencyId, id)) ? ok({ id }) : notFound;
    } catch (err) {
      if (isForeignKeyViolation(err)) {
        return fail('conflict', 'Users still have this role; give them another role first');
      }
      throw err;
    }
  }
});

export type RoleService = ReturnType<typeof createRoleService>;
