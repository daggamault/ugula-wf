import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

export type ScriptRunner = {
  eval: (script: string, numKeys: number, ...args: (string | number)[]) => Promise<unknown>;
};

export type Leases = {
  acquire: (id: string) => Promise<boolean>;
  release: (id: string) => Promise<void>;
};

export type Limiter = <T>(task: () => Promise<T>) => Promise<T>;

type LimiterOptions = {
  wait?: (ms: number) => Promise<unknown>;
  random?: () => number;
  onReleaseError?: (err: unknown) => void;
  tries?: number;
};

const ACQUIRE = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[2]) then return 0 end
redis.call('ZADD', KEYS[1], now + tonumber(ARGV[3]), ARGV[1])
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[3]))
return 1
`;

const RELEASE = `return redis.call('ZREM', KEYS[1], ARGV[1])`;

const MIN_BACKOFF_MS = 25;

const MAX_BACKOFF_MS = 1_000;

export const createRedisLeases = (
  redis: ScriptRunner,
  { key, limit, ttlMs }: { key: string; limit: number; ttlMs: number }
): Leases => ({
  acquire: async (id) => (await redis.eval(ACQUIRE, 1, key, id, limit, ttlMs)) === 1,
  release: async (id) => {
    await redis.eval(RELEASE, 1, key, id);
  }
});

const backoffMs = (attempt: number, random: () => number) =>
  Math.min(MAX_BACKOFF_MS, MIN_BACKOFF_MS * 2 ** attempt) * (0.5 + random() / 2);

const LIMIT_BUSY = 'LIMIT_BUSY';

const BUSY_RETRY_MS = 1_000;

const limitBusy = (retryAfterMs: number) =>
  Object.assign(new Error('Every shared slot is busy'), { code: LIMIT_BUSY, retryAfterMs });

export const busyRetryAfter = (err: unknown): number | null =>
  err instanceof Error && 'code' in err && err.code === LIMIT_BUSY && 'retryAfterMs' in err
    ? Number(err.retryAfterMs)
    : null;

export const createSharedLimiter =
  (
    leases: Leases,
    {
      wait = delay,
      random = Math.random,
      onReleaseError = () => {},
      tries = 3
    }: LimiterOptions = {}
  ): Limiter =>
  async (task) => {
    const id = randomUUID();
    for (let attempt = 0; !(await leases.acquire(id)); attempt++) {
      if (attempt + 1 >= tries) throw limitBusy(BUSY_RETRY_MS * (1 + 2 * random()));
      await wait(backoffMs(attempt, random));
    }
    try {
      return await task();
    } finally {
      await leases.release(id).catch(onReleaseError);
    }
  };
