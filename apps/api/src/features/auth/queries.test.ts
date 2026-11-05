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

describe('findActiveUserByEmail', () => {
  it('matches the lowercased email among active platform users or users of active organizations', async () => {
    const user = { id: 'u-1', email: 'dev@example.com', password_hash: 'h' };
    const { db, queries } = createRecordingDb(() => [user]);
    assert.deepEqual(await findActiveUserByEmail(db, 'Dev@Example.COM'), user);
    const [find] = queries;
    assert.ok(find?.sql.includes('left join "organizations"'));
    assert.ok(find?.sql.includes('"users"."is_active" = $1'));
    assert.ok(find?.sql.includes('("users"."type" = $2 or "organizations"."is_active" = $3)'));
    assert.ok(find?.sql.includes('"users"."email" = $4'));
    assert.deepEqual(find?.parameters, [true, 'platform', true, 'dev@example.com']);
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
    const [find] = queries;
    assert.ok(find?.sql.includes('"organizations"."name" as "organization_name"'));
    assert.ok(find?.sql.includes('"users"."is_owner"'));
    assert.deepEqual(find?.parameters, [true, 'platform', true, 'u-1']);
    await db.destroy();
  });
});

describe('findInvitationByHash', () => {
  it('joins the agency, organization, role and any existing account by email', async () => {
    const { db, queries } = createRecordingDb(() => []);
    assert.equal(await findInvitationByHash(db, 'hash'), undefined);
    const [find] = queries;
    assert.ok(find?.sql.includes('left join "users" as "u" on "u"."email" = "i"."email"'));
    assert.ok(find?.sql.includes('"u"."organization_id" as "user_organization_id"'));
    assert.ok(find?.sql.includes('"a"."is_active" = $2'));
    assert.ok(find?.sql.includes('"o"."is_active" = $3'));
    assert.deepEqual(find?.parameters, ['hash', true, true]);
    await db.destroy();
  });
});

describe('invitation writes', () => {
  it('inserts organization users, adds memberships only once and consumes the invitation', async () => {
    const at = new Date('2026-01-01T00:00:00Z');
    const { db, queries } = createRecordingDb((q) =>
      q.sql.includes('returning') ? [{ id: 'u-9' }] : []
    );
    assert.deepEqual(
      await insertOrganizationUser(db, {
        organizationId: 'o-1',
        email: 'new@example.com',
        firstName: 'New',
        lastName: 'User',
        passwordHash: 'h'
      }),
      { id: 'u-9' }
    );
    assert.equal(
      await insertMembership(db, {
        organizationId: 'o-1',
        agencyId: 't-1',
        userId: 'u-9',
        roleId: 'r-1'
      }),
      true
    );
    assert.equal(await consumeInvitation(db, 'i-1', 'h', at), true);
    const [user, membership, del] = queries;
    assert.ok(user?.sql.startsWith('insert into "users"'));
    assert.deepEqual(user?.parameters, [
      'organization',
      'o-1',
      'new@example.com',
      'New',
      'User',
      'h'
    ]);
    assert.ok(
      membership?.sql.endsWith('on conflict ("agency_id", "user_id") do nothing returning "id"')
    );
    assert.deepEqual(membership?.parameters, ['o-1', 't-1', 'u-9', 'r-1']);
    assert.equal(
      del?.sql,
      'delete from "invitations" where "id" = $1 and "token_hash" = $2 and "expires_at" > $3 returning "id"'
    );
    assert.deepEqual(del?.parameters, ['i-1', 'h', at]);
    await db.destroy();
  });

  it('reports an existing membership and a spent invitation', async () => {
    const { db } = createRecordingDb(() => []);
    const input = { organizationId: 'o-1', agencyId: 't-1', userId: 'u-9', roleId: 'r-1' };
    assert.equal(await insertMembership(db, input), false);
    assert.equal(await consumeInvitation(db, 'i-1', 'h', new Date()), false);
    await db.destroy();
  });
});

describe('password tokens', () => {
  it('consumes only unexpired tokens and clears every token after setting the password', async () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('delete from "password_tokens" where "token_hash"')
        ? [{ user_id: 'u-1' }]
        : []
    );
    assert.deepEqual(await consumePasswordToken(db, 'hash', now), { user_id: 'u-1' });
    await setUserPassword(db, 'u-1', 'new-hash');
    const [consume, update, clear] = queries;
    assert.ok(consume?.sql.includes('"expires_at" > $2 returning "user_id"'));
    assert.deepEqual(consume?.parameters, ['hash', now]);
    assert.ok(update?.sql.startsWith('update "users" set "password_hash" = $1'));
    assert.equal(update?.parameters[0], 'new-hash');
    assert.equal(update?.parameters.at(-1), 'u-1');
    assert.equal(clear?.sql, 'delete from "password_tokens" where "user_id" = $1');
    await db.destroy();
  });
});
