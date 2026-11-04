import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Hono } from 'hono';
import type { AuthEnv } from './auth.ts';
import { memoryRedis, testSessions, withSession } from './testing.ts';

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
      agencyId: 't-1',
      email: 'dev@example.com',
      body: { a: 1 }
    });
  });
});

describe('memoryRedis', () => {
  it('counts, expires and deletes keys like Redis', async () => {
    const { redis: store, keys } = memoryRedis();
    assert.equal(await store.ttl('a'), -2);
    assert.equal(await store.incr('a'), 1);
    assert.equal(await store.ttl('a'), -1);
    await store.expire('a', 60);
    assert.equal(await store.incr('a'), 2);
    assert.equal(await store.ttl('a'), 60);
    await store.set('b', 'x', 'EX', 5);
    await store.sadd('s', 'x');
    assert.deepEqual(await store.smembers('s'), ['x']);
    assert.deepEqual(keys(), ['a', 'b', 's']);
    await store.del('a', 'b', 's');
    assert.deepEqual(keys(), []);
  });
});
