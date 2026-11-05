import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createSessionStore, hashPassword, hashToken } from '@ugula/auth';
import { createRecordingDb } from '@ugula/db/testing';
import { memoryRedis } from '../../shared/testing.ts';
import { createSignInThrottle } from '../../shared/throttle.ts';
import { createAuthService } from './service.ts';

const memorySessions = () => createSessionStore(memoryRedis().redis);

const throttle = () => createSignInThrottle(memoryRedis().redis);

const IP = '10.0.0.1';

const NOW = new Date('2026-01-01T00:00:00Z');

const profile = {
  id: 'u-1',
  email: 'dev@example.com',
  first_name: 'Dev',
  last_name: 'User',
  type: 'organization',
  is_owner: false,
  organization_id: 'o-1',
  organization_name: 'Development EMS'
};

const credentials = async () => ({
  id: 'u-1',
  email: 'dev@example.com',
  password_hash: await hashPassword('P@ssw0rd123')
});

const invitation = {
  id: 'i-1',
  email: 'new@example.com',
  first_name: 'New',
  last_name: 'User',
  agency_id: 't-1',
  role_id: 'r-1',
  expires_at: new Date('2026-01-02T00:00:00Z'),
  agency_name: 'Development',
  organization_id: 'o-1',
  organization_name: 'Development EMS',
  role_name: 'Biller',
  user_id: null as string | null,
  user_organization_id: null as string | null,
  user_active: true,
  password_hash: null as string | null
};

describe('auth service', () => {
  it('signs in active users, resolves sessions and signs out', async () => {
    const user = await credentials();
    const { db } = createRecordingDb((q) =>
      q.sql.includes('"users"."password_hash"') ? [user] : [profile]
    );
    const service = createAuthService({ db, sessions: memorySessions(), throttle: throttle() });
    assert.deepEqual(await service.signIn({ email: 'dev@example.com', password: 'wrong' }, IP), {
      ok: false,
      failure: { code: 'unauthorized', message: 'Invalid email or password' }
    });
    const signed = await service.signIn({ email: 'dev@example.com', password: 'P@ssw0rd123' }, IP);
    assert.ok(signed.ok);
    assert.deepEqual(signed.value.session, { userId: 'u-1', email: 'dev@example.com' });
    assert.deepEqual(await service.session(signed.value.token), {
      ok: true,
      value: signed.value.session
    });
    await service.signOut(signed.value.token);
    assert.equal((await service.session(signed.value.token)).ok, false);
    assert.equal((await service.session(undefined)).ok, false);
    await db.destroy();
  });

  it('locks out repeated failures from one address without checking the password', async () => {
    const user = await credentials();
    const { db, queries } = createRecordingDb(() => [user]);
    const service = createAuthService({ db, sessions: memorySessions(), throttle: throttle() });
    for (let i = 0; i < 5; i++) {
      await service.signIn({ email: 'dev@example.com', password: 'wrong' }, IP);
    }
    const before = queries.length;
    const locked = await service.signIn({ email: 'dev@example.com', password: 'P@ssw0rd123' }, IP);
    assert.deepEqual(locked, {
      ok: false,
      failure: {
        code: 'rate_limited',
        message: 'Too many failed sign-ins. Try again later.',
        details: { retryAfter: 30 }
      }
    });
    assert.equal(queries.length, before);
    const elsewhere = await service.signIn(
      { email: 'dev@example.com', password: 'P@ssw0rd123' },
      '10.0.0.2'
    );
    assert.equal(elsewhere.ok, true);
    await db.destroy();
  });

  it('ends every session of a user who was removed or deactivated', async () => {
    const user = await credentials();
    let active = true;
    const { db, queries } = createRecordingDb((q) =>
      q.sql.includes('"users"."password_hash"') ? [user] : active ? [profile] : []
    );
    const service = createAuthService({ db, sessions: memorySessions(), throttle: throttle() });
    const signed = await service.signIn({ email: 'dev@example.com', password: 'P@ssw0rd123' }, IP);
    const other = await service.signIn({ email: 'dev@example.com', password: 'P@ssw0rd123' }, IP);
    assert.ok(signed.ok && other.ok);
    assert.equal((await service.session(signed.value.token)).ok, true);
    assert.equal(queries.at(-1)?.parameters.at(-1), 'u-1');
    active = false;
    assert.equal((await service.session(signed.value.token)).ok, false);
    active = true;
    assert.equal((await service.session(signed.value.token)).ok, false);
    assert.equal((await service.session(other.value.token)).ok, false);
    await db.destroy();
  });

  it('rejects unknown users after the same password work as known ones', async () => {
    const user = await credentials();
    const { db } = createRecordingDb((q) =>
      q.parameters.includes('dev@example.com') ? [user] : []
    );
    const service = createAuthService({ db, sessions: memorySessions(), throttle: throttle() });
    await service.signIn({ email: 'nobody@example.com', password: 'warm-up' }, IP);
    const timed = async (email: string) => {
      const start = performance.now();
      const res = await service.signIn({ email, password: 'wrong' }, IP);
      assert.deepEqual(res, {
        ok: false,
        failure: { code: 'unauthorized', message: 'Invalid email or password' }
      });
      return performance.now() - start;
    };
    const known = await timed('dev@example.com');
    const unknown = await timed('nobody@example.com');
    assert.ok(unknown > known / 3, `unknown ${unknown}ms vs known ${known}ms`);
    await db.destroy();
  });

  it('describes the current user, or refuses an inactive one', async () => {
    let rows: unknown[] = [profile];
    const { db } = createRecordingDb(() => rows);
    const service = createAuthService({ db, sessions: memorySessions(), throttle: throttle() });
    assert.deepEqual(await service.me('u-1'), {
      ok: true,
      value: {
        id: 'u-1',
        email: 'dev@example.com',
        firstName: 'Dev',
        lastName: 'User',
        type: 'organization',
        isOwner: false,
        organizationId: 'o-1',
        organizationName: 'Development EMS'
      }
    });
    rows = [];
    assert.deepEqual(await service.me('u-1'), {
      ok: false,
      failure: { code: 'unauthorized', message: 'Unauthorized' }
    });
    await db.destroy();
  });
});

const invalid = {
  ok: false,
  failure: { code: 'invalid', message: 'This link is invalid or has expired' }
};

type Outcome = { consumed?: boolean; joined?: boolean; fail?: Error };

const invitationService = (row: typeof invitation | undefined, outcome: Outcome = {}) => {
  const { db, queries } = createRecordingDb((q) => {
    if (q.sql.startsWith('delete from "invitations"')) {
      return outcome.consumed === false ? [] : [{ id: 'i-1' }];
    }
    if (q.sql.includes('from "invitations"')) return row ? [row] : [];
    if (q.sql.startsWith('insert into "users"')) {
      if (outcome.fail) throw outcome.fail;
      return [{ id: 'u-new' }];
    }
    if (q.sql.startsWith('insert into "memberships"')) {
      return outcome.joined === false ? [] : [{ id: 'm-1' }];
    }
    return [];
  });
  const sessions = memorySessions();
  return {
    db,
    queries,
    sessions,
    service: createAuthService({ db, sessions, throttle: throttle(), now: () => NOW })
  };
};

describe('auth service invitations', () => {
  it('previews a pending invitation by the hash of its token', async () => {
    const { db, queries, service } = invitationService(invitation);
    assert.deepEqual(await service.previewInvitation('tok'), {
      ok: true,
      value: {
        email: 'new@example.com',
        firstName: 'New',
        lastName: 'User',
        agencyName: 'Development',
        organizationName: 'Development EMS',
        roleName: 'Biller',
        hasAccount: false
      }
    });
    assert.equal(queries[0]?.parameters[0], hashToken('tok'));
    await db.destroy();
  });

  it('refuses unknown, expired, other-organization and deactivated-account invitations', async () => {
    for (const row of [
      undefined,
      { ...invitation, expires_at: NOW },
      { ...invitation, user_id: 'u-2', user_organization_id: 'o-2', password_hash: 'h' },
      {
        ...invitation,
        user_id: 'u-2',
        user_organization_id: 'o-1',
        user_active: false,
        password_hash: 'h'
      }
    ]) {
      const { db, service } = invitationService(row);
      assert.deepEqual(await service.previewInvitation('tok'), invalid);
      assert.deepEqual(
        await service.acceptInvitation({ token: 'tok', password: 'P@ssw0rd123456' }, IP),
        invalid
      );
      await db.destroy();
    }
  });

  it('creates the account and membership for a new user, then signs them in', async () => {
    const { db, queries, sessions, service } = invitationService(invitation);
    assert.deepEqual(await service.acceptInvitation({ token: 'tok', password: 'short' }, IP), {
      ok: false,
      failure: { code: 'invalid', message: 'Use at least 12 characters' }
    });
    const res = await service.acceptInvitation({ token: 'tok', password: 'P@ssw0rd123456' }, IP);
    assert.ok(res.ok);
    assert.deepEqual(res.value.session, { userId: 'u-new', email: 'new@example.com' });
    assert.deepEqual(await sessions.get(res.value.token), res.value.session);
    const writes = queries.filter((q) => !/^(select|begin|commit|rollback)/.test(q.sql));
    assert.deepEqual(
      writes.map((q) => q.sql.split(' ').slice(0, 3).join(' ')),
      ['delete from "invitations"', 'insert into "users"', 'insert into "memberships"']
    );
    assert.deepEqual(writes[0]?.parameters, ['i-1', hashToken('tok'), NOW]);
    assert.equal(writes[1]?.parameters[1], 'o-1');
    assert.notEqual(writes[1]?.parameters[5], 'P@ssw0rd123456');
    assert.deepEqual(writes[2]?.parameters, ['o-1', 't-1', 'u-new', 'r-1']);
    await db.destroy();
  });

  it('accepts an invitation only once, even when two accepts race', async () => {
    const spent = invitationService(invitation, { consumed: false });
    assert.deepEqual(
      await spent.service.acceptInvitation({ token: 'tok', password: 'P@ssw0rd123456' }, IP),
      invalid
    );
    assert.ok(!spent.queries.some((q) => q.sql.startsWith('insert into')));
    await spent.db.destroy();
    const taken = invitationService(invitation, {
      fail: Object.assign(new Error('dup'), { code: '23505' })
    });
    assert.deepEqual(
      await taken.service.acceptInvitation({ token: 'tok', password: 'P@ssw0rd123456' }, IP),
      invalid
    );
    await taken.db.destroy();
  });

  it('never changes the role of someone already in the agency', async () => {
    const member = invitationService(
      {
        ...invitation,
        user_id: 'u-2',
        user_organization_id: 'o-1',
        password_hash: await hashPassword('Existing-pass1')
      },
      { joined: false }
    );
    assert.deepEqual(
      await member.service.acceptInvitation({ token: 'tok', password: 'Existing-pass1' }, IP),
      { ok: false, failure: { code: 'conflict', message: 'You already belong to this agency' } }
    );
    assert.ok(!member.queries.some((q) => q.sql.includes('do update')));
    await member.db.destroy();
  });

  it('throttles wrong passwords for an existing account', async () => {
    const existing = {
      ...invitation,
      user_id: 'u-2',
      user_organization_id: 'o-1',
      password_hash: await hashPassword('Existing-pass1')
    };
    const { db, queries, service } = invitationService(existing);
    for (let i = 0; i < 5; i++) {
      await service.acceptInvitation({ token: 'tok', password: 'wrong' }, IP);
    }
    assert.deepEqual(
      await service.acceptInvitation({ token: 'tok', password: 'Existing-pass1' }, IP),
      {
        ok: false,
        failure: {
          code: 'rate_limited',
          message: 'Too many failed sign-ins. Try again later.',
          details: { retryAfter: 30 }
        }
      }
    );
    assert.ok(!queries.some((q) => q.sql.startsWith('delete from "invitations"')));
    await db.destroy();
  });

  it('adds an existing account of the organization once its password checks out', async () => {
    const existing = {
      ...invitation,
      user_id: 'u-2',
      user_organization_id: 'o-1',
      password_hash: await hashPassword('Existing-pass1')
    };
    const { db, queries, service } = invitationService(existing);
    const preview = await service.previewInvitation('tok');
    assert.ok(preview.ok);
    assert.equal(preview.value.hasAccount, true);
    assert.deepEqual(await service.acceptInvitation({ token: 'tok', password: 'wrong' }, IP), {
      ok: false,
      failure: { code: 'unauthorized', message: 'Invalid email or password' }
    });
    const res = await service.acceptInvitation({ token: 'tok', password: 'Existing-pass1' }, IP);
    assert.ok(res.ok);
    assert.deepEqual(res.value.session, { userId: 'u-2', email: 'new@example.com' });
    assert.equal(
      queries.some((q) => q.sql.startsWith('insert into "users"')),
      false
    );
    assert.ok(queries.some((q) => q.sql.startsWith('insert into "memberships"')));
    await db.destroy();
  });
});

describe('auth service set password', () => {
  it('consumes the token, stores a new hash and ends every session of the user', async () => {
    const { redis } = memoryRedis();
    const sessions = createSessionStore(redis);
    const live = await sessions.create({ userId: 'u-1', email: 'dev@example.com' });
    const { db, queries } = createRecordingDb((q) =>
      q.sql.includes('"token_hash"') ? [{ user_id: 'u-1' }] : []
    );
    const service = createAuthService({ db, sessions, throttle: throttle(), now: () => NOW });
    assert.deepEqual(await service.setPassword({ token: 'tok', password: 'New-password1' }), {
      ok: true,
      value: { status: 'ok' }
    });
    assert.deepEqual(queries[0]?.parameters, [hashToken('tok'), NOW]);
    const update = queries.find((q) => q.sql.startsWith('update "users"'));
    assert.ok(typeof update?.parameters[0] === 'string');
    assert.notEqual(update?.parameters[0], 'New-password1');
    assert.equal(await sessions.get(live), null);
    await db.destroy();
  });

  it('refuses spent or expired tokens without touching the user', async () => {
    const { db, queries } = createRecordingDb(() => []);
    const service = createAuthService({ db, sessions: memorySessions(), throttle: throttle() });
    assert.deepEqual(
      await service.setPassword({ token: 'tok', password: 'New-password1' }),
      invalid
    );
    assert.equal(queries.length, 1);
    await db.destroy();
  });
});
