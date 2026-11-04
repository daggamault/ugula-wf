import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createSessionStore, hashPassword } from '@ugula/auth';
import { createRecordingDb } from '@ugula/db/testing';
import { memoryRedis } from '../../shared/testing.ts';
import { createSignInThrottle } from '../../shared/throttle.ts';
import { createAuthService } from './service.ts';

const memorySessions = () => createSessionStore(memoryRedis().redis);

const throttle = () => createSignInThrottle(memoryRedis().redis);

const IP = '10.0.0.1';

describe('auth service', () => {
  it('signs in active users, resolves sessions and signs out', async () => {
    const passwordHash = await hashPassword('P@ssw0rd123');
    const { db } = createRecordingDb(() => [
      { id: 'u-1', agency_id: 't-1', email: 'dev@example.com', password_hash: passwordHash }
    ]);
    const service = createAuthService({ db, sessions: memorySessions(), throttle: throttle() });
    assert.deepEqual(await service.signIn({ email: 'dev@example.com', password: 'wrong' }, IP), {
      ok: false,
      failure: { code: 'unauthorized', message: 'Invalid email or password' }
    });
    const signed = await service.signIn({ email: 'dev@example.com', password: 'P@ssw0rd123' }, IP);
    assert.ok(signed.ok);
    assert.deepEqual(signed.value.session, {
      userId: 'u-1',
      agencyId: 't-1',
      email: 'dev@example.com'
    });
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
    const passwordHash = await hashPassword('P@ssw0rd123');
    const { db, queries } = createRecordingDb(() => [
      { id: 'u-1', agency_id: 't-1', email: 'dev@example.com', password_hash: passwordHash }
    ]);
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

  it('ends sessions whose user or agency was removed or deactivated', async () => {
    const passwordHash = await hashPassword('P@ssw0rd123');
    let member = true;
    const { db, queries } = createRecordingDb((q) =>
      q.sql.includes('"users"."password_hash"')
        ? [{ id: 'u-1', agency_id: 't-1', email: 'dev@example.com', password_hash: passwordHash }]
        : member
          ? [{ id: 'u-1' }]
          : []
    );
    const service = createAuthService({ db, sessions: memorySessions(), throttle: throttle() });
    const signed = await service.signIn({ email: 'dev@example.com', password: 'P@ssw0rd123' }, IP);
    const other = await service.signIn({ email: 'dev@example.com', password: 'P@ssw0rd123' }, IP);
    assert.ok(signed.ok && other.ok);
    assert.equal((await service.session(signed.value.token)).ok, true);
    const check = queries.at(-1);
    assert.ok(
      check?.sql.includes('"users"."is_active" = $') &&
        check.sql.includes('"agencies"."is_active" = $')
    );
    assert.deepEqual(check?.parameters.slice(0, 2), ['u-1', 't-1']);
    member = false;
    assert.equal((await service.session(signed.value.token)).ok, false);
    member = true;
    assert.equal((await service.session(signed.value.token)).ok, false);
    assert.equal((await service.session(other.value.token)).ok, false);
    await db.destroy();
  });

  it('rejects unknown users', async () => {
    const { db } = createRecordingDb();
    const res = await createAuthService({
      db,
      sessions: memorySessions(),
      throttle: throttle()
    }).signIn({ email: 'nobody@example.com', password: 'x' }, IP);
    assert.equal(res.ok, false);
    await db.destroy();
  });
});
