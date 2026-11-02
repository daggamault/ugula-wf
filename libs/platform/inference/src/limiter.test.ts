import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  backoffMs,
  createRedisLeases,
  createSharedLimiter,
  type Leases,
  type ScriptRunner
} from './limiter.ts';

const memoryLeases = (limit: number) => {
  const held = new Set<string>();
  let peak = 0;
  const leases: Leases = {
    acquire: async (id) => {
      if (held.size >= limit) return false;
      held.add(id);
      peak = Math.max(peak, held.size);
      return true;
    },
    release: async (id) => {
      held.delete(id);
    }
  };
  return { leases, held, peak: () => peak };
};

const tick = () => new Promise((r) => setImmediate(r));

describe('createSharedLimiter', () => {
  it('runs at most the leased number of tasks across callers and backs off while full', async () => {
    const { leases, held, peak } = memoryLeases(2);
    const waits: number[] = [];
    const limit = createSharedLimiter(leases, {
      wait: async (ms) => {
        waits.push(ms);
        await tick();
      },
      random: () => 1
    });
    const gates: (() => void)[] = [];
    const runs = [1, 2, 3, 4].map((n) =>
      limit(async () => {
        await new Promise<void>((r) => gates.push(r));
        return n;
      })
    );
    await tick();
    assert.equal(gates.length, 2);
    for (let i = 0; i < 4; i++) {
      while (gates.length <= i) await tick();
      gates[i]?.();
    }
    assert.deepEqual(await Promise.all(runs), [1, 2, 3, 4]);
    assert.equal(peak(), 2);
    assert.equal(held.size, 0);
    assert.ok(waits.length > 0);
  });

  it('releases the lease when a task fails', async () => {
    const { leases, held } = memoryLeases(1);
    const limit = createSharedLimiter(leases);
    await assert.rejects(
      limit(() => Promise.reject(new Error('boom'))),
      /boom/
    );
    assert.equal(held.size, 0);
    assert.equal(await limit(async () => 'ok'), 'ok');
  });

  it('backs off exponentially with jitter up to a second', () => {
    assert.equal(
      backoffMs(0, () => 1),
      25
    );
    assert.equal(
      backoffMs(2, () => 1),
      100
    );
    assert.equal(
      backoffMs(2, () => 0),
      50
    );
    assert.equal(
      backoffMs(20, () => 1),
      1_000
    );
  });
});

describe('createRedisLeases', () => {
  it('acquires and releases leases atomically in one sorted set', async () => {
    const calls: unknown[][] = [];
    const redis: ScriptRunner = {
      eval: async (script, numKeys, ...args) => {
        calls.push([script.includes('ZADD') ? 'acquire' : 'release', numKeys, ...args]);
        return script.includes('ZADD') ? (args[1] === 'a' ? 1 : 0) : 1;
      }
    };
    const leases = createRedisLeases(redis, { key: 'k', limit: 2, ttlMs: 150_000 });
    assert.equal(await leases.acquire('a'), true);
    assert.equal(await leases.acquire('b'), false);
    await leases.release('a');
    assert.deepEqual(calls, [
      ['acquire', 1, 'k', 'a', 2, 150_000],
      ['acquire', 1, 'k', 'b', 2, 150_000],
      ['release', 1, 'k', 'a']
    ]);
  });
});
