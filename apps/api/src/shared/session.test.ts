import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createSessionStore, type RedisLike } from './session.ts';

const createMemoryRedis = () => {
  const map = new Map<string, string>();
  const redis: RedisLike = {
    set: async (k, v) => {
      map.set(k, v);
    },
    get: async (k) => map.get(k) ?? null,
    del: async (...keys) => {
      for (const k of keys) map.delete(k);
    }
  };
  return { redis, map };
};

describe('createSessionStore', () => {
  it('creates, retrieves, and destroys sessions', async () => {
    const { redis } = createMemoryRedis();
    const store = createSessionStore(redis);
    const data = { userId: 'u-1', tenantId: 't-1', email: 'dev@example.com' };

    const token = await store.create(data);
    assert.ok(token.length >= 32);
    assert.deepEqual(await store.get(token), data);

    await store.destroy(token);
    assert.equal(await store.get(token), null);
  });

  it('returns null for malformed JSON or invalid session payload', async () => {
    const { redis, map } = createMemoryRedis();
    const store = createSessionStore(redis);

    map.set('session:bad-json', '{not-json');
    assert.equal(await store.get('bad-json'), null);

    map.set('session:bad-schema', JSON.stringify({ userId: 'u-1' }));
    assert.equal(await store.get('bad-schema'), null);
  });
});
