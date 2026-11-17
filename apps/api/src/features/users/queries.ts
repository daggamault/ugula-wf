import { type Db, rolePermissionsSql } from '@ugula/db';
import { sql } from 'kysely';
import { facetCounts, whereFacets } from '../../shared/facets.ts';
import { type PageRequest, paged } from '../../shared/paging.ts';
import { containsPattern } from '../../shared/search.ts';
import type { InvitationSort, UserSort } from './schemas.ts';

export type UserFilters = PageRequest<UserSort> & {
  q?: string | undefined;
  role: readonly string[];
};

const ROLE_FACETS = { role: { value: sql.ref('r.id'), label: sql.ref('r.name') } };

type RoleFacet = keyof typeof ROLE_FACETS;

export type MemberRow = {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  is_owner: boolean;
  version: number;
  role_id: string;
  role_name: string;
  permissions: string[];
};

const memberRows = (db: Db, agencyId: string) =>
  db
    .selectFrom('memberships as m')
    .innerJoin('users as u', 'u.id', 'm.user_id')
    .innerJoin('roles as r', 'r.id', 'm.role_id')
    .select([
      'u.id',
      'u.email',
      'u.first_name',
      'u.last_name',
      'u.is_owner',
      'm.version',
      'r.id as role_id',
      'r.name as role_name',
      rolePermissionsSql('r.id').as('permissions')
    ])
    .where('m.agency_id', '=', agencyId);

const USER_ORDER = {
  name: sql`(lower(u.last_name), lower(u.first_name))`,
  email: sql.ref('u.email'),
  role: sql`lower(r.name)`
};

const filteredMembers = (db: Db, agencyId: string, f: UserFilters, except?: RoleFacet) => {
  let q = memberRows(db, agencyId);
  if (f.q) {
    const like = containsPattern(f.q);
    q = q.where((eb) =>
      eb.or([
        eb(sql`lower(u.first_name || ' ' || u.last_name)`, 'like', like),
        eb('u.email', 'like', like)
      ])
    );
  }
  return whereFacets(q, ROLE_FACETS, f, except);
};

export const searchMembers = async (db: Db, agencyId: string, f: UserFilters) => {
  const [page, facets] = await Promise.all([
    paged(filteredMembers(db, agencyId, f), f, USER_ORDER, sql.ref('u.id')),
    facetCounts((except) => filteredMembers(db, agencyId, f, except), ROLE_FACETS)
  ]);
  return { ...page, facets };
};

export const findMember = (db: Db, agencyId: string, userId: string) =>
  memberRows(db, agencyId).where('u.id', '=', userId).executeTakeFirst();

export const findRolePermissions = (db: Db, agencyId: string, roleId: string) =>
  db
    .selectFrom('roles as r')
    .select(['r.id', 'r.name', rolePermissionsSql('r.id').as('permissions')])
    .where('r.agency_id', '=', agencyId)
    .where('r.id', '=', roleId)
    .executeTakeFirst();

export const setMemberRole = (
  db: Db,
  agencyId: string,
  userId: string,
  input: { roleId: string; version: number }
) =>
  db
    .updateTable('memberships')
    .set({ role_id: input.roleId, version: sql`version + 1`, updated_at: sql`now()` })
    .where('agency_id', '=', agencyId)
    .where('user_id', '=', userId)
    .where('version', '=', input.version)
    .returning('id')
    .executeTakeFirst();

export const deleteMember = (db: Db, agencyId: string, userId: string) =>
  db
    .deleteFrom('memberships')
    .where('agency_id', '=', agencyId)
    .where('user_id', '=', userId)
    .returning('id')
    .executeTakeFirst();

export const unassignTasks = async (db: Db, agencyId: string, userId: string) => {
  await db
    .updateTable('tasks')
    .set({ assignee_id: null, updated_at: sql`now()` })
    .where('agency_id', '=', agencyId)
    .where('assignee_id', '=', userId)
    .execute();
};

export const hasMemberships = async (db: Db, userId: string) =>
  (await db
    .selectFrom('memberships')
    .select('id')
    .where('user_id', '=', userId)
    .limit(1)
    .executeTakeFirst()) !== undefined;

export const findMemberRanks = (db: Db, userId: string, requesterId: string) =>
  db
    .selectFrom('memberships as t')
    .leftJoin('memberships as r', (j) =>
      j.onRef('r.agency_id', '=', 't.agency_id').on('r.user_id', '=', requesterId)
    )
    .select([
      't.agency_id',
      rolePermissionsSql('t.role_id').as('permissions'),
      rolePermissionsSql('r.role_id').as('held')
    ])
    .where('t.user_id', '=', userId)
    .execute();

export const listGrantableRoles = (db: Db, agencyId: string) =>
  db
    .selectFrom('roles as r')
    .select(['r.id', 'r.name', rolePermissionsSql('r.id').as('permissions')])
    .where('r.agency_id', '=', agencyId)
    .orderBy(sql`lower(r.name)`)
    .execute();

export const replacePasswordToken = async (
  db: Db,
  input: { userId: string; hash: string; expiresAt: Date; now: Date }
) => {
  await db
    .deleteFrom('password_tokens')
    .where((eb) => eb.or([eb('user_id', '=', input.userId), eb('expires_at', '<=', input.now)]))
    .execute();
  await db
    .insertInto('password_tokens')
    .values({ user_id: input.userId, token_hash: input.hash, expires_at: input.expiresAt })
    .execute();
};

export type InvitationFilters = PageRequest<InvitationSort> & {
  q?: string | undefined;
  role: readonly string[];
};

const INVITATION_ORDER = {
  name: sql`(lower(i.last_name), lower(i.first_name))`,
  email: sql.ref('i.email'),
  role: sql`lower(r.name)`,
  expires: sql.ref('i.expires_at')
};

const filteredInvitations = (
  db: Db,
  agencyId: string,
  f: InvitationFilters,
  except?: RoleFacet
) => {
  let q = db
    .selectFrom('invitations as i')
    .innerJoin('roles as r', 'r.id', 'i.role_id')
    .select([
      'i.id',
      'i.email',
      'i.first_name',
      'i.last_name',
      'i.expires_at',
      'i.created_at',
      'r.id as role_id',
      'r.name as role_name',
      rolePermissionsSql('r.id').as('permissions')
    ])
    .where('i.agency_id', '=', agencyId);
  if (f.q) {
    const like = containsPattern(f.q);
    q = q.where((eb) =>
      eb.or([
        eb(sql`lower(i.first_name || ' ' || i.last_name)`, 'like', like),
        eb('i.email', 'like', like)
      ])
    );
  }
  return whereFacets(q, ROLE_FACETS, f, except);
};

export const searchInvitations = async (db: Db, agencyId: string, f: InvitationFilters) => {
  const [page, facets] = await Promise.all([
    paged(filteredInvitations(db, agencyId, f), f, INVITATION_ORDER, sql.ref('i.id')),
    facetCounts((except) => filteredInvitations(db, agencyId, f, except), ROLE_FACETS)
  ]);
  return { ...page, facets };
};

export const findInvitation = (db: Db, agencyId: string, id: string) =>
  db
    .selectFrom('invitations as i')
    .select(['i.id', 'i.email', rolePermissionsSql('i.role_id').as('permissions')])
    .where('i.agency_id', '=', agencyId)
    .where('i.id', '=', id)
    .executeTakeFirst();

export const isMemberEmail = async (db: Db, agencyId: string, email: string) =>
  (await db
    .selectFrom('memberships as m')
    .innerJoin('users as u', 'u.id', 'm.user_id')
    .select('m.id')
    .where('m.agency_id', '=', agencyId)
    .where('u.email', '=', email)
    .executeTakeFirst()) !== undefined;

export const upsertInvitation = (
  db: Db,
  input: {
    agencyId: string;
    roleId: string;
    email: string;
    firstName: string;
    lastName: string;
    hash: string;
    invitedBy: string;
    expiresAt: Date;
  }
) =>
  db
    .insertInto('invitations')
    .values({
      agency_id: input.agencyId,
      role_id: input.roleId,
      email: input.email,
      first_name: input.firstName,
      last_name: input.lastName,
      token_hash: input.hash,
      invited_by_id: input.invitedBy,
      expires_at: input.expiresAt
    })
    .onConflict((oc) =>
      oc.columns(['agency_id', 'email']).doUpdateSet({
        role_id: input.roleId,
        first_name: input.firstName,
        last_name: input.lastName,
        token_hash: input.hash,
        invited_by_id: input.invitedBy,
        expires_at: input.expiresAt,
        updated_at: sql`now()`
      })
    )
    .returning('id')
    .executeTakeFirstOrThrow();

export const renewInvitation = (
  db: Db,
  agencyId: string,
  id: string,
  input: { hash: string; expiresAt: Date }
) =>
  db
    .updateTable('invitations')
    .set({ token_hash: input.hash, expires_at: input.expiresAt, updated_at: sql`now()` })
    .where('agency_id', '=', agencyId)
    .where('id', '=', id)
    .returning('id')
    .executeTakeFirst();

export const deleteInvitation = (db: Db, agencyId: string, id: string) =>
  db
    .deleteFrom('invitations')
    .where('agency_id', '=', agencyId)
    .where('id', '=', id)
    .returning('id')
    .executeTakeFirst();
