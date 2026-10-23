import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db';
import { hashPassword } from '@ugula/passwords';
import { createSessionStore } from '@ugula/sessions';
import { createAuthService } from './service.ts';

const memorySessions = () => {
  const map = new Map<string, string>();
  return createSessionStore({
    set: async (k, v) => void map.set(k, v),
    get: async (k) => map.get(k) ?? null,
    del: async (...keys) => {
      for (const k of keys) map.delete(k);
    }
  });
};

describe('auth service', () => {
  it('signs in active users, resolves sessions and signs out', async () => {
    const passwordHash = await hashPassword('P@ssw0rd123');
    const { db } = createRecordingDb(() => [
      { id: 'u-1', tenant_id: 't-1', email: 'dev@example.com', password_hash: passwordHash }
    ]);
    const service = createAuthService({ db, sessions: memorySessions() });

    assert.deepEqual(await service.signIn({ email: 'dev@example.com', password: 'wrong' }), {
      ok: false,
      failure: { code: 'unauthorized', message: 'Invalid email or password' }
    });
    const signed = await service.signIn({ email: 'dev@example.com', password: 'P@ssw0rd123' });
    assert.ok(signed.ok);
    assert.deepEqual(signed.value.session, {
      userId: 'u-1',
      tenantId: 't-1',
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

  it('rejects unknown users', async () => {
    const { db } = createRecordingDb();
    const res = await createAuthService({ db, sessions: memorySessions() }).signIn({
      email: 'nobody@example.com',
      password: 'x'
    });
    assert.equal(res.ok, false);
    await db.destroy();
  });
});
