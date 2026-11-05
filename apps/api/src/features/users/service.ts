import { canGrant, isUserAdmin, type Permission } from '@ugula/access';
import { createToken } from '@ugula/auth';
import { type Db, permissionsOf } from '@ugula/db';
import type { AgencyAccess } from '../../shared/access.ts';
import { hasUserAdmin, lockMemberships } from '../../shared/memberships.ts';
import { fail, ok } from '../../shared/result.ts';
import {
  deleteInvitation,
  deleteMember,
  findInvitation,
  findMember,
  findRolePermissions,
  hasMemberships,
  insertPasswordToken,
  isMemberEmail,
  listInvitations,
  type MemberRow,
  renewInvitation,
  searchMembers,
  setMemberRole,
  type UserFilters,
  upsertInvitation
} from './queries.ts';
import type { InviteInput } from './schemas.ts';

type UserServiceDeps = {
  db: Db;
  webUrl: string;
  now: () => Date;
  endSessions: (userId: string) => Promise<void>;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export const INVITATION_DAYS = 7;

const notFound = fail('not_found', 'User not found');

const roleNotFound = fail('invalid', 'Role not found');

const ungrantable = fail('forbidden', "You can't give a role with permissions you don't hold");

export type BlockedReason = 'self' | 'outranked' | null;

const blockedReason = (access: AgencyAccess, row: MemberRow): BlockedReason =>
  row.id === access.userId
    ? 'self'
    : (row.is_owner && !access.isOrganizationAdmin) ||
        !canGrant(access.permissions, permissionsOf(row))
      ? 'outranked'
      : null;

const toUser = (access: AgencyAccess, row: MemberRow) => ({
  id: row.id,
  email: row.email,
  firstName: row.first_name,
  lastName: row.last_name,
  isOwner: row.is_owner,
  version: row.version,
  role: { id: row.role_id, name: row.role_name },
  blockedReason: blockedReason(access, row)
});

const lastAdmin = fail('conflict', 'The agency needs at least one user who can manage users');

export const createUserService = ({ db, webUrl, now, endSessions }: UserServiceDeps) => {
  const link = (path: string, token: string) =>
    `${webUrl}${path}?token=${encodeURIComponent(token)}`;
  const grantableRole = async (tx: Db, access: AgencyAccess, roleId: string) => {
    const role = await findRolePermissions(tx, access.agencyId, roleId);
    if (!role) return roleNotFound;
    const permissions: Permission[] = permissionsOf(role);
    return canGrant(access.permissions, permissions) ? ok({ ...role, permissions }) : ungrantable;
  };
  return {
    list: async (access: AgencyAccess, filters: UserFilters) => {
      const page = await searchMembers(db, access.agencyId, filters);
      return ok({ ...page, items: page.items.map((r) => toUser(access, r)) });
    },
    find: async (access: AgencyAccess, userId: string) => {
      const row = await findMember(db, access.agencyId, userId);
      return row ? ok(toUser(access, row)) : notFound;
    },
    update: (access: AgencyAccess, userId: string, input: { roleId: string; version: number }) =>
      db.transaction().execute(async (tx) => {
        await lockMemberships(tx, access.agencyId);
        const row = await findMember(tx, access.agencyId, userId);
        if (!row) return notFound;
        const blocked = blockedReason(access, row);
        if (blocked === 'self') return fail('forbidden', "You can't change your own role");
        if (blocked) return fail('forbidden', 'This user has permissions you do not hold');
        const role = await grantableRole(tx, access, input.roleId);
        if (!role.ok) return role;
        if (
          isUserAdmin(permissionsOf(row)) &&
          !isUserAdmin(role.value.permissions) &&
          !(await hasUserAdmin(tx, access.agencyId, { userId }))
        ) {
          return lastAdmin;
        }
        if (!(await setMemberRole(tx, access.agencyId, userId, input))) {
          return fail('conflict', 'Someone else changed this user; reload and try again');
        }
        const saved = await findMember(tx, access.agencyId, userId);
        return saved ? ok(toUser(access, saved)) : notFound;
      }),
    remove: async (access: AgencyAccess, userId: string) => {
      const res = await db.transaction().execute(async (tx) => {
        await lockMemberships(tx, access.agencyId);
        const row = await findMember(tx, access.agencyId, userId);
        if (!row) return notFound;
        const blocked = blockedReason(access, row);
        if (blocked === 'self') return fail('forbidden', "You can't remove yourself");
        if (blocked) return fail('forbidden', 'This user has permissions you do not hold');
        if (
          isUserAdmin(permissionsOf(row)) &&
          !(await hasUserAdmin(tx, access.agencyId, { userId }))
        ) {
          return lastAdmin;
        }
        await deleteMember(tx, access.agencyId, userId);
        return ok({ id: userId, unassigned: !row.is_owner && !(await hasMemberships(tx, userId)) });
      });
      if (res.ok && res.value.unassigned) await endSessions(userId);
      return res.ok ? ok({ id: res.value.id }) : res;
    },
    passwordLink: async (access: AgencyAccess, userId: string) => {
      const row = await findMember(db, access.agencyId, userId);
      if (!row) return notFound;
      if (blockedReason(access, row) === 'outranked') {
        return fail('forbidden', 'This user has permissions you do not hold');
      }
      const { token, hash } = createToken();
      await insertPasswordToken(db, {
        userId,
        hash,
        expiresAt: new Date(now().getTime() + DAY_MS)
      });
      return ok({ link: link('/password', token) });
    },
    invitations: async (access: AgencyAccess) =>
      ok({
        items: (await listInvitations(db, access.agencyId)).map((i) => ({
          id: i.id,
          email: i.email,
          firstName: i.first_name,
          lastName: i.last_name,
          role: { id: i.role_id, name: i.role_name },
          isGrantable: canGrant(access.permissions, permissionsOf(i)),
          isExpired: i.expires_at.getTime() <= now().getTime(),
          expiresAt: i.expires_at,
          createdAt: i.created_at
        }))
      }),
    invite: (access: AgencyAccess, input: InviteInput) =>
      db.transaction().execute(async (tx) => {
        const role = await grantableRole(tx, access, input.roleId);
        if (!role.ok) return role;
        if (await isMemberEmail(tx, access.agencyId, input.email)) {
          return fail('conflict', 'That person is already a user of this agency');
        }
        const { token, hash } = createToken();
        const { id } = await upsertInvitation(tx, {
          agencyId: access.agencyId,
          roleId: input.roleId,
          email: input.email,
          firstName: input.firstName,
          lastName: input.lastName,
          hash,
          invitedBy: access.userId,
          expiresAt: new Date(now().getTime() + INVITATION_DAYS * DAY_MS)
        });
        return ok({ id, link: link('/invitation', token) });
      }),
    resend: async (access: AgencyAccess, id: string) => {
      const found = await findInvitation(db, access.agencyId, id);
      if (!found) return fail('not_found', 'Invitation not found');
      if (!canGrant(access.permissions, permissionsOf(found))) return ungrantable;
      const { token, hash } = createToken();
      await renewInvitation(db, access.agencyId, id, {
        hash,
        expiresAt: new Date(now().getTime() + INVITATION_DAYS * DAY_MS)
      });
      return ok({ id, link: link('/invitation', token) });
    },
    removeInvitation: async (access: AgencyAccess, id: string) => {
      const found = await findInvitation(db, access.agencyId, id);
      if (!found) return fail('not_found', 'Invitation not found');
      if (!canGrant(access.permissions, permissionsOf(found))) return ungrantable;
      await deleteInvitation(db, access.agencyId, id);
      return ok({ id });
    }
  };
};

export type UserService = ReturnType<typeof createUserService>;
