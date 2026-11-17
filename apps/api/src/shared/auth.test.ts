import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Hono } from 'hono';
import { type AuthEnv, requireAuth } from './auth.ts';

const session = { userId: 'u-1', email: 'dev@example.com' };

const authApp = () => {
  const seen: (string | undefined)[] = [];
  const app = new Hono<AuthEnv>()
    .use(
      requireAuth(async (token) => {
        seen.push(token);
        return token === 'good' ? session : null;
      })
    )
    .get('/', (c) => c.json(c.get('session')));
  return { app, seen };
};

const respond = async (res: Response) => [res.status, await res.json()];

describe('requireAuth', () => {
  it('exposes the session of a valid session cookie to handlers', async () => {
    const { app, seen } = authApp();
    assert.deepEqual(
      await respond(await app.request('/', { headers: { cookie: 'ugula_session=good' } })),
      [200, session]
    );
    assert.deepEqual(seen, ['good']);
  });

  it('rejects a request without a session cookie', async () => {
    const { app, seen } = authApp();
    assert.deepEqual(await respond(await app.request('/')), [401, { error: 'Unauthorized' }]);
    assert.deepEqual(seen, [undefined]);
  });

  it('rejects an unknown session token', async () => {
    const { app, seen } = authApp();
    assert.deepEqual(
      await respond(
        await app.request('/', { headers: { cookie: 'other=good; ugula_session=bad' } })
      ),
      [401, { error: 'Unauthorized' }]
    );
    assert.deepEqual(seen, ['bad']);
  });
});
