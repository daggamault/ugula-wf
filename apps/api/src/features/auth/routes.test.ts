import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fail, ok } from '../../shared/result.ts';
import { createAuthRoutes } from './routes.ts';
import type { AuthService } from './service.ts';

const session = { userId: 'u-1', tenantId: 't-1', email: 'dev@example.com' };

const service: AuthService = {
  signIn: async ({ password }) =>
    password === 'P@ssw0rd123'
      ? ok({ token: 'tok', session })
      : fail('unauthorized', 'Invalid email or password'),
  session: async (token) => (token === 'tok' ? ok(session) : fail('unauthorized', 'Unauthorized')),
  signOut: async () => undefined
};

const routes = createAuthRoutes({ service, sseUrl: 'http://localhost:3002', secureCookie: false });

const post = (path: string, body?: object, cookie = '') =>
  routes.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    ...(body ? { body: JSON.stringify(body) } : {})
  });

describe('auth routes', () => {
  it('signs in with a session cookie, fetches /me, and signs out', async () => {
    const bad = await post('/sign-in', { email: 'dev@example.com', password: 'wrong' });
    assert.equal(bad.status, 401);
    assert.deepEqual(await bad.json(), { error: 'Invalid email or password' });

    const signIn = await post('/sign-in', { email: 'Dev@Example.com', password: 'P@ssw0rd123' });
    assert.equal(signIn.status, 200);
    const cookie = (signIn.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    assert.equal(cookie, 'ugula_session=tok');

    const me = await routes.request('/me', { headers: { cookie } });
    assert.deepEqual(await me.json(), {
      user: { id: 'u-1', tenantId: 't-1', email: 'dev@example.com' },
      sseUrl: 'http://localhost:3002'
    });

    assert.equal((await post('/sign-out', undefined, cookie)).status, 200);
    const anon = await routes.request('/me');
    assert.equal(anon.status, 401);
    assert.ok(anon.headers.get('set-cookie')?.includes('ugula_session=;'));
  });
});
