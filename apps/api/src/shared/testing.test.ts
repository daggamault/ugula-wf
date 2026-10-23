import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Hono } from 'hono';
import type { AuthEnv } from './auth.ts';
import { testSessions, withSession } from './testing.ts';

describe('testSessions', () => {
  it('only knows the test session token', async () => {
    assert.equal(await testSessions.get('other'), null);
  });
});

describe('withSession', () => {
  it('sends requests as the test user', async () => {
    const request = withSession(
      new Hono<AuthEnv>().post('/', async (c) =>
        c.json({ ...c.get('session'), body: await c.req.json() })
      )
    );
    const res = await request('/', { method: 'POST', body: '{"a":1}' });
    assert.deepEqual(await res.json(), {
      userId: 'u-1',
      tenantId: 't-1',
      email: 'dev@example.com',
      body: { a: 1 }
    });
  });
});
