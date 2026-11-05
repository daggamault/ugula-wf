import type { Db } from '@ugula/db';

type AuthUserRecord = {
  id: string;
  email: string;
  password_hash: string;
};

const activeUsers = (db: Db) =>
  db
    .selectFrom('users')
    .leftJoin('organizations', 'organizations.id', 'users.organization_id')
    .where('users.is_active', '=', true)
    .where((eb) =>
      eb.or([eb('users.type', '=', 'platform'), eb('organizations.is_active', '=', true)])
    );

export const findActiveUserByEmail = (db: Db, email: string): Promise<AuthUserRecord | undefined> =>
  activeUsers(db)
    .select(['users.id', 'users.email', 'users.password_hash'])
    .where('users.email', '=', email.toLowerCase())
    .executeTakeFirst();

export const findActiveUser = (db: Db, userId: string) =>
  activeUsers(db)
    .select([
      'users.id',
      'users.email',
      'users.first_name',
      'users.last_name',
      'users.type',
      'users.is_owner',
      'users.organization_id',
      'organizations.name as organization_name'
    ])
    .where('users.id', '=', userId)
    .executeTakeFirst();

export const findInvitationByHash = (db: Db, hash: string) =>
  db
    .selectFrom('invitations as i')
    .innerJoin('agencies as a', 'a.id', 'i.agency_id')
    .innerJoin('organizations as o', 'o.id', 'a.organization_id')
    .innerJoin('roles as r', 'r.id', 'i.role_id')
    .leftJoin('users as u', 'u.email', 'i.email')
    .select([
      'i.id',
      'i.email',
      'i.first_name',
      'i.last_name',
      'i.agency_id',
      'i.role_id',
      'i.expires_at',
      'a.name as agency_name',
      'a.organization_id',
      'o.name as organization_name',
      'r.name as role_name',
      'u.id as user_id',
      'u.organization_id as user_organization_id',
      'u.password_hash',
      'u.is_active as user_active'
    ])
    .where('i.token_hash', '=', hash)
    .where('a.is_active', '=', true)
    .where('o.is_active', '=', true)
    .executeTakeFirst();

export const insertOrganizationUser = (
  db: Db,
  input: {
    organizationId: string;
    email: string;
    firstName: string;
    lastName: string;
    passwordHash: string;
  }
) =>
  db
    .insertInto('users')
    .values({
      type: 'organization',
      organization_id: input.organizationId,
      email: input.email,
      first_name: input.firstName,
      last_name: input.lastName,
      password_hash: input.passwordHash
    })
    .returning('id')
    .executeTakeFirstOrThrow();

export const insertMembership = async (
  db: Db,
  input: { organizationId: string; agencyId: string; userId: string; roleId: string }
) =>
  (await db
    .insertInto('memberships')
    .values({
      organization_id: input.organizationId,
      agency_id: input.agencyId,
      user_id: input.userId,
      role_id: input.roleId
    })
    .onConflict((oc) => oc.columns(['agency_id', 'user_id']).doNothing())
    .returning('id')
    .executeTakeFirst()) !== undefined;

export const consumeInvitation = async (db: Db, id: string, hash: string, now: Date) =>
  (await db
    .deleteFrom('invitations')
    .where('id', '=', id)
    .where('token_hash', '=', hash)
    .where('expires_at', '>', now)
    .returning('id')
    .executeTakeFirst()) !== undefined;

export const consumePasswordToken = (db: Db, hash: string, now: Date) =>
  db
    .deleteFrom('password_tokens')
    .where('token_hash', '=', hash)
    .where('expires_at', '>', now)
    .returning('user_id')
    .executeTakeFirst();

export const setUserPassword = async (db: Db, userId: string, passwordHash: string) => {
  await db
    .updateTable('users')
    .set({ password_hash: passwordHash, updated_at: new Date() })
    .where('id', '=', userId)
    .execute();
  await db.deleteFrom('password_tokens').where('user_id', '=', userId).execute();
};
