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

  it('ends sessions whose user or tenant was removed or deactivated', async () => {
    const passwordHash = await hashPassword('P@ssw0rd123');
    let member = true;
    const { db, queries } = createRecordingDb((q) =>
      q.sql.includes('"users"."password_hash"')
        ? [{ id: 'u-1', tenant_id: 't-1', email: 'dev@example.com', password_hash: passwordHash }]
        : member
          ? [{ id: 'u-1' }]
          : []
    );
    const service = createAuthService({ db, sessions: memorySessions() });
    const signed = await service.signIn({ email: 'dev@example.com', password: 'P@ssw0rd123' });
    assert.ok(signed.ok);
    assert.equal((await service.session(signed.value.token)).ok, true);
    const check = queries.at(-1);
    assert.ok(
      check?.sql.includes('"users"."is_active" = $') &&
        check.sql.includes('"tenants"."is_active" = $')
    );
    assert.deepEqual(check?.parameters.slice(0, 2), ['u-1', 't-1']);
    member = false;
    assert.equal((await service.session(signed.value.token)).ok, false);
    member = true;
    assert.equal((await service.session(signed.value.token)).ok, false);
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
