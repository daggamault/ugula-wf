import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createSessionStore, type RedisLike, readCookie, SESSION_TTL_SECONDS } from './sessions.ts';

const createMemoryRedis = () => {
  const map = new Map<string, string>();
  const sets = new Map<string, Set<string>>();
  const ttls = new Map<string, number>();
  const redis: RedisLike = {
    set: async (k, v, _mode, ttl) => {
      map.set(k, v);
      ttls.set(k, ttl);
    },
    get: async (k) => map.get(k) ?? null,
    del: async (...keys) => {
      for (const k of keys) {
        map.delete(k);
        sets.delete(k);
      }
    },
    sadd: async (k, ...members) => {
      sets.set(k, new Set([...(sets.get(k) ?? []), ...members]));
    },
    srem: async (k, ...members) => {
      for (const m of members) sets.get(k)?.delete(m);
    },
    smembers: async (k) => [...(sets.get(k) ?? [])],
    expire: async (k, ttl) => ttls.set(k, ttl)
  };
  return { redis, map, sets, ttls };
};

const data = { userId: 'u-1', agencyId: 't-1', email: 'dev@example.com' };

describe('createSessionStore', () => {
  it('creates, retrieves, and destroys sessions', async () => {
    const { redis, sets } = createMemoryRedis();
    const store = createSessionStore(redis);

    const token = await store.create(data);
    assert.ok(token.length >= 32);
    assert.deepEqual(await store.get(token), data);

    assert.notEqual(await store.create(data), token);

    await store.destroy(token);
    assert.equal(await store.get(token), null);
    assert.equal(sets.get('user-sessions:u-1')?.has(token), false);
    await store.destroy('missing');
  });

  it('expires sessions and the user index after the ttl', async () => {
    const { redis, ttls } = createMemoryRedis();
    const token = await createSessionStore(redis, 60).create(data);
    assert.deepEqual(Object.fromEntries(ttls), {
      [`session:${token}`]: 60,
      'user-sessions:u-1': 60
    });
    const other = await createSessionStore(redis).create(data);
    assert.equal(ttls.get(`session:${other}`), SESSION_TTL_SECONDS);
  });

  it('destroys every session of one user and leaves others alone', async () => {
    const { redis, sets } = createMemoryRedis();
    const store = createSessionStore(redis);
    const [a, b] = [await store.create(data), await store.create(data)];
    const other = await store.create({ ...data, userId: 'u-2' });

    await store.destroyAll('u-1');
    assert.equal(await store.get(a), null);
    assert.equal(await store.get(b), null);
    assert.deepEqual(await store.get(other), { ...data, userId: 'u-2' });
    assert.equal(sets.has('user-sessions:u-1'), false);
    await store.destroyAll('nobody');
  });

  it('returns null for malformed JSON or invalid session payload', async () => {
    const { redis, map } = createMemoryRedis();
    const store = createSessionStore(redis);

    map.set('session:bad-json', '{not-json');
    assert.equal(await store.get('bad-json'), null);

    map.set('session:bad-email', JSON.stringify({ ...data, email: 'nope' }));
    assert.equal(await store.get('bad-email'), null);

    map.set('session:bad-schema', JSON.stringify({ userId: 'u-1' }));
    assert.equal(await store.get('bad-schema'), null);
    await store.destroy('bad-schema');
    assert.equal(map.has('session:bad-schema'), false);
  });
});

describe('readCookie', () => {
  it('reads one cookie from a header', () => {
    assert.equal(readCookie('a=1; ugula_session=tok%3D; b=2', 'ugula_session'), 'tok=');
    assert.equal(readCookie(undefined, 'ugula_session'), undefined);
    assert.equal(readCookie('a=1', 'ugula_session'), undefined);
    assert.equal(readCookie('ugula_session_x=1;ugula_session=a=b', 'ugula_session'), 'a=b');
    assert.equal(readCookie('ugula_session=', 'ugula_session'), '');
    assert.equal(readCookie('ugula_session=%E0%A4%A', 'ugula_session'), undefined);
  });
});
