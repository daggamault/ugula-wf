import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fail, ok } from '../../shared/result.ts';
import { createAuthRoutes } from './routes.ts';
import type { AuthService } from './service.ts';

const session = { userId: 'u-1', agencyId: 't-1', email: 'dev@example.com' };

const ips: string[] = [];

const service: AuthService = {
  signIn: async ({ password }, ip) => {
    ips.push(ip);
    if (password === 'locked') {
      return fail('rate_limited', 'Too many failed sign-ins. Try again later.', {
        retryAfter: 30
      });
    }
    return password === 'P@ssw0rd123'
      ? ok({ token: 'tok', session })
      : fail('unauthorized', 'Invalid email or password');
  },
  session: async (token) => (token === 'tok' ? ok(session) : fail('unauthorized', 'Unauthorized')),
  signOut: async () => undefined
};

const routes = createAuthRoutes({
  service,
  sseUrl: 'http://localhost:3002',
  secureCookie: false,
  clientIp: () => '10.0.0.1'
});

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
    assert.deepEqual(ips, ['10.0.0.1', '10.0.0.1']);
    const cookie = (signIn.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    assert.equal(cookie, 'ugula_session=tok');
    const me = await routes.request('/me', { headers: { cookie } });
    assert.deepEqual(await me.json(), {
      user: { id: 'u-1', agencyId: 't-1', email: 'dev@example.com' },
      sseUrl: 'http://localhost:3002'
    });
    assert.equal((await post('/sign-out', undefined, cookie)).status, 200);
    const anon = await routes.request('/me');
    assert.equal(anon.status, 401);
    assert.ok(anon.headers.get('set-cookie')?.includes('ugula_session=;'));
  });

  it('sets an http-only, same-site session cookie that lives as long as the session', async () => {
    const res = await post('/sign-in', { email: 'dev@example.com', password: 'P@ssw0rd123' });
    const cookie = res.headers.get('set-cookie') ?? '';
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.match(cookie, /Path=\//);
    assert.match(cookie, /Max-Age=\d+/);
    assert.doesNotMatch(cookie, /Secure/);
  });

  it('rejects malformed sign-ins before reaching the service', async () => {
    const before = ips.length;
    const res = await post('/sign-in', { email: 'not-an-email', password: '' });
    assert.equal(res.status, 400);
    assert.equal(typeof ((await res.json()) as { error: unknown }).error, 'string');
    assert.equal((await post('/sign-in')).status, 400);
    assert.equal(ips.length, before);
  });

  it('answers throttled sign-ins with 429 and Retry-After', async () => {
    const res = await post('/sign-in', { email: 'dev@example.com', password: 'locked' });
    assert.equal(res.status, 429);
    assert.equal(res.headers.get('retry-after'), '30');
    assert.deepEqual(await res.json(), {
      error: 'Too many failed sign-ins. Try again later.',
      retryAfter: 30
    });
  });
});
