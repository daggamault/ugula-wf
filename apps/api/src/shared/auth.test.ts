import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Hono } from 'hono';
import { type AuthEnv, requireAuth } from './auth.ts';

const session = { userId: 'u-1', tenantId: 't-1', email: 'dev@example.com' };

describe('requireAuth', () => {
  it('exposes the authenticated session to handlers and rejects everything else', async () => {
    const seen: (string | undefined)[] = [];
    const app = new Hono<AuthEnv>()
      .use(
        requireAuth(async (token) => {
          seen.push(token);
          return token === 'good' ? session : null;
        })
      )
      .get('/', (c) => c.json(c.get('session')));
    assert.equal((await app.request('/')).status, 401);
    assert.equal(
      (await app.request('/', { headers: { cookie: 'ugula_session=bad' } })).status,
      401
    );
    const ok = await app.request('/', { headers: { cookie: 'ugula_session=good' } });
    assert.deepEqual(await ok.json(), session);
    assert.deepEqual(seen, [undefined, 'bad', 'good']);
  });
});
