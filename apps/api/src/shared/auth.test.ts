import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { SessionStore } from '@ugula/sessions';
import { Hono } from 'hono';
import { type AuthEnv, requireAuth } from './auth.ts';

const sessions: SessionStore = {
  create: async () => 'token',
  get: async (token) =>
    token === 'good' ? { userId: 'u-1', tenantId: 't-1', email: 'dev@example.com' } : null,
  destroy: async () => undefined
};

describe('requireAuth', () => {
  it('exposes the session to handlers and rejects missing or unknown tokens', async () => {
    const app = new Hono<AuthEnv>()
      .use(requireAuth(sessions))
      .get('/', (c) => c.json(c.get('session')));
    assert.equal((await app.request('/')).status, 401);
    assert.equal(
      (await app.request('/', { headers: { cookie: 'ugula_session=bad' } })).status,
      401
    );
    const ok = await app.request('/', { headers: { cookie: 'ugula_session=good' } });
    assert.deepEqual(await ok.json(), { userId: 'u-1', tenantId: 't-1', email: 'dev@example.com' });
  });
});
