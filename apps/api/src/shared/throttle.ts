import { createHash } from 'node:crypto';

export type ThrottleStore = {
  incr: (key: string) => Promise<number>;
  expire: (key: string, seconds: number) => Promise<unknown>;
  ttl: (key: string) => Promise<number>;
  set: (key: string, value: string, mode: 'EX', ttl: number) => Promise<unknown>;
  del: (...keys: string[]) => Promise<unknown>;
};

const FREE_ATTEMPTS = 5;
const WINDOW_SECONDS = 60 * 60;
const BASE_LOCK_SECONDS = 30;
const MAX_LOCK_SECONDS = 15 * 60;

export const lockSeconds = (failures: number) =>
  failures < FREE_ATTEMPTS
    ? 0
    : Math.min(BASE_LOCK_SECONDS * 2 ** (failures - FREE_ATTEMPTS), MAX_LOCK_SECONDS);

export const createSignInThrottle = (store: ThrottleStore) => {
  const keys = (email: string, ip: string) => {
    const id = createHash('sha256').update(`${email}\n${ip}`).digest('base64url');
    return { failures: `sign-in:failures:${id}`, lock: `sign-in:lock:${id}` };
  };
  return {
    retryAfter: async (email: string, ip: string) =>
      Math.max(0, await store.ttl(keys(email, ip).lock)),
    failed: async (email: string, ip: string) => {
      const { failures, lock } = keys(email, ip);
      const n = await store.incr(failures);
      await store.expire(failures, WINDOW_SECONDS);
      const seconds = lockSeconds(n);
      if (seconds) await store.set(lock, String(n), 'EX', seconds);
    },
    succeeded: async (email: string, ip: string) => {
      const { failures, lock } = keys(email, ip);
      await store.del(failures, lock);
    }
  };
};

export type SignInThrottle = ReturnType<typeof createSignInThrottle>;
