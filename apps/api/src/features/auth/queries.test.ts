import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import {
  consumeInvitation,
  consumePasswordToken,
  findActiveUser,
  findActiveUserByEmail,
  findInvitationByHash,
  insertMembership,
  insertOrganizationUser,
  setUserPassword
} from './queries.ts';

const ACTIVE_USERS =
  'from "users" left join "organizations" on "organizations"."id" = "users"."organization_id" ' +
  'where "users"."is_active" = $1 and ("users"."type" = $2 or "organizations"."is_active" = $3)';

const NEW_USER = {
  organizationId: 'o-1',
  email: 'new@example.com',
  firstName: 'New',
  lastName: 'User',
  passwordHash: 'h'
};

const MEMBERSHIP = { organizationId: 'o-1', agencyId: 't-1', userId: 'u-9', roleId: 'r-1' };

describe('findActiveUserByEmail', () => {
  it('matches the lowercased email among active platform users or users of active organizations', async () => {
    const user = { id: 'u-1', email: 'dev@example.com', password_hash: 'h' };
    const { db, queries } = createRecordingDb(() => [user]);
    assert.deepEqual(await findActiveUserByEmail(db, 'Dev@Example.COM'), user);
    assert.deepEqual(
      queries.map((q) => [q.sql, q.parameters]),
      [
        [
          `select "users"."id", "users"."email", "users"."password_hash" ${ACTIVE_USERS} and "users"."email" = $4`,
          [true, 'platform', true, 'dev@example.com']
        ]
      ]
    );
    await db.destroy();
  });

  it('finds nobody when no active user has the email', async () => {
    const { db } = createRecordingDb(() => []);
    assert.equal(await findActiveUserByEmail(db, 'nobody@example.com'), undefined);
    await db.destroy();
  });
});

describe('findActiveUser', () => {
  it('reads the profile with its organization name by id', async () => {
    const { db, queries } = createRecordingDb(() => [{ id: 'u-1' }]);
    assert.deepEqual(await findActiveUser(db, 'u-1'), { id: 'u-1' });
    assert.deepEqual(
      queries.map((q) => [q.sql, q.parameters]),
      [
        [
          'select "users"."id", "users"."email", "users"."first_name", "users"."last_name", ' +
            '"users"."type", "users"."is_owner", "users"."organization_id", ' +
            `"organizations"."name" as "organization_name" ${ACTIVE_USERS} and "users"."id" = $4`,
          [true, 'platform', true, 'u-1']
        ]
      ]
    );
    await db.destroy();
  });

  it('finds nobody for an inactive or unknown id', async () => {
    const { db } = createRecordingDb(() => []);
    assert.equal(await findActiveUser(db, 'u-1'), undefined);
    await db.destroy();
  });
});

describe('findInvitationByHash', () => {
  it('joins the agency, organization, role and any existing account by email', async () => {
    const invitation = { id: 'i-1', email: 'new@example.com' };
    const { db, queries } = createRecordingDb(() => [invitation]);
    assert.deepEqual(await findInvitationByHash(db, 'hash'), invitation);
    assert.deepEqual(
      queries.map((q) => [q.sql, q.parameters]),
      [
        [
          'select "i"."id", "i"."email", "i"."first_name", "i"."last_name", "i"."agency_id", ' +
            '"i"."role_id", "i"."expires_at", "a"."name" as "agency_name", "a"."organization_id", ' +
            '"o"."name" as "organization_name", "r"."name" as "role_name", "u"."id" as "user_id", ' +
            '"u"."organization_id" as "user_organization_id", "u"."password_hash", ' +
            '"u"."is_active" as "user_active" from "invitations" as "i" ' +
            'inner join "agencies" as "a" on "a"."id" = "i"."agency_id" ' +
            'inner join "organizations" as "o" on "o"."id" = "a"."organization_id" ' +
            'inner join "roles" as "r" on "r"."id" = "i"."role_id" ' +
            'left join "users" as "u" on "u"."email" = "i"."email" ' +
            'where "i"."token_hash" = $1 and "a"."is_active" = $2 and "o"."is_active" = $3',
          ['hash', true, true]
        ]
      ]
    );
    await db.destroy();
  });

  it('finds no invitation for an unknown hash', async () => {
    const { db } = createRecordingDb(() => []);
    assert.equal(await findInvitationByHash(db, 'hash'), undefined);
    await db.destroy();
  });
});

describe('insertOrganizationUser', () => {
  it('inserts an organization user and returns its id', async () => {
    const { db, queries } = createRecordingDb(() => [{ id: 'u-9' }]);
    assert.deepEqual(await insertOrganizationUser(db, NEW_USER), { id: 'u-9' });
    assert.deepEqual(
      queries.map((q) => [q.sql, q.parameters]),
      [
        [
          'insert into "users" ("type", "organization_id", "email", "first_name", "last_name", ' +
            '"password_hash") values ($1, $2, $3, $4, $5, $6) returning "id"',
          ['organization', 'o-1', 'new@example.com', 'New', 'User', 'h']
        ]
      ]
    );
    await db.destroy();
  });

  it('throws when the insert returns no row', async () => {
    const { db } = createRecordingDb(() => []);
    await assert.rejects(insertOrganizationUser(db, NEW_USER), { message: 'no result' });
    await db.destroy();
  });
});

describe('insertMembership', () => {
  it('adds a membership once per agency and user', async () => {
    const { db, queries } = createRecordingDb(() => [{ id: 'm-1' }]);
    assert.equal(await insertMembership(db, MEMBERSHIP), true);
    assert.deepEqual(
      queries.map((q) => [q.sql, q.parameters]),
      [
        [
          'insert into "memberships" ("organization_id", "agency_id", "user_id", "role_id") ' +
            'values ($1, $2, $3, $4) on conflict ("agency_id", "user_id") do nothing returning "id"',
          ['o-1', 't-1', 'u-9', 'r-1']
        ]
      ]
    );
    await db.destroy();
  });

  it('reports an existing membership', async () => {
    const { db } = createRecordingDb(() => []);
    assert.equal(await insertMembership(db, MEMBERSHIP), false);
    await db.destroy();
  });
});

describe('consumeInvitation', () => {
  it('deletes the unexpired invitation with the matching hash', async () => {
    const at = new Date('2026-01-01T00:00:00Z');
    const { db, queries } = createRecordingDb(() => [{ id: 'i-1' }]);
    assert.equal(await consumeInvitation(db, 'i-1', 'h', at), true);
    assert.deepEqual(
      queries.map((q) => [q.sql, q.parameters]),
      [
        [
          'delete from "invitations" where "id" = $1 and "token_hash" = $2 and "expires_at" > $3 returning "id"',
          ['i-1', 'h', at]
        ]
      ]
    );
    await db.destroy();
  });

  it('reports a spent or expired invitation', async () => {
    const { db } = createRecordingDb(() => []);
    assert.equal(await consumeInvitation(db, 'i-1', 'h', new Date()), false);
    await db.destroy();
  });
});

describe('password tokens', () => {
  it('consumes only an unexpired token and returns its user', async () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const { db, queries } = createRecordingDb(() => [{ user_id: 'u-1' }]);
    assert.deepEqual(await consumePasswordToken(db, 'hash', now), { user_id: 'u-1' });
    assert.deepEqual(
      queries.map((q) => [q.sql, q.parameters]),
      [
        [
          'delete from "password_tokens" where "token_hash" = $1 and "expires_at" > $2 returning "user_id"',
          ['hash', now]
        ]
      ]
    );
    await db.destroy();
  });

  it('finds no user for a spent or expired token', async () => {
    const { db } = createRecordingDb(() => []);
    assert.equal(await consumePasswordToken(db, 'hash', new Date()), undefined);
    await db.destroy();
  });

  it('sets the password and then clears every token of the user', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await setUserPassword(db, 'u-1', 'new-hash');
    assert.deepEqual(
      queries.map((q) => [q.sql, q.parameters]),
      [
        [
          'update "users" set "password_hash" = $1, "updated_at" = now() where "id" = $2',
          ['new-hash', 'u-1']
        ],
        ['delete from "password_tokens" where "user_id" = $1', ['u-1']]
      ]
    );
    await db.destroy();
  });
});
