import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hashPassword } from '@ugula/passwords';
import { createSessionStore } from '../../shared/session.ts';
import { createAuthRoutes } from './routes.ts';

const createTestStore = () => {
  const map = new Map<string, string>();
  return createSessionStore({
    set: async (k, v) => {
      map.set(k, v);
    },
    get: async (k) => map.get(k) ?? null,
    del: async (...keys) => {
      for (const k of keys) map.delete(k);
    }
  });
};

describe('auth routes', () => {
  it('signs in, fetches /me, and signs out', async () => {
    const passwordHash = await hashPassword('P@ssw0rd123');
    const routes = createAuthRoutes({
      findUserByEmail: async (email) =>
        email === 'dev@example.com'
          ? {
              id: 'u-1',
              tenant_id: 't-1',
              email: 'dev@example.com',
              password_hash: passwordHash
            }
          : undefined,
      sessions: createTestStore(),
      sseUrl: 'http://localhost:3002',
      secureCookie: false
    });

    const badRes = await routes.request('/sign-in', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'dev@example.com', password: 'wrong' })
    });
    assert.equal(badRes.status, 401);

    const signInRes = await routes.request('/sign-in', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'Dev@Example.com', password: 'P@ssw0rd123' })
    });
    assert.equal(signInRes.status, 200);
    const setCookieHeader = signInRes.headers.get('set-cookie') ?? '';
    assert.ok(setCookieHeader.includes('ugula_session='));
    const cookie = setCookieHeader.split(';')[0] ?? '';

    const meRes = await routes.request('/me', {
      headers: { cookie }
    });
    assert.equal(meRes.status, 200);
    assert.deepEqual(await meRes.json(), {
      user: { id: 'u-1', tenantId: 't-1', email: 'dev@example.com' },
      sseUrl: 'http://localhost:3002'
    });

    const outRes = await routes.request('/sign-out', {
      method: 'POST',
      headers: { cookie }
    });
    assert.equal(outRes.status, 200);

    const afterOutRes = await routes.request('/me', {
      headers: { cookie }
    });
    assert.equal(afterOutRes.status, 401);
  });
});
