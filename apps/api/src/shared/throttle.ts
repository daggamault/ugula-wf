import { createHash } from 'node:crypto';

export type ThrottleStore = {
  incr: (key: string) => Promise<number>;
  expire: (key: string, seconds: number) => Promise<unknown>;
  ttl: (key: string) => Promise<number>;
  set: {
    (key: string, value: string, mode: 'EX', ttl: number): Promise<unknown>;
    (key: string, value: string, mode: 'EX', ttl: number, flag: 'NX'): Promise<unknown>;
  };
  del: (...keys: string[]) => Promise<unknown>;
};

const FREE_ATTEMPTS = 5;
const WINDOW_SECONDS = 60 * 60;
const BASE_LOCK_SECONDS = 30;
const MAX_LOCK_SECONDS = 15 * 60;
const BUSY_SECONDS = 30;

export const lockSeconds = (failures: number) =>
  failures < FREE_ATTEMPTS
    ? 0
    : Math.min(BASE_LOCK_SECONDS * 2 ** (failures - FREE_ATTEMPTS), MAX_LOCK_SECONDS);

export const createSignInThrottle = (store: ThrottleStore) => {
  const keys = (email: string, ip: string) => {
    const id = createHash('sha256').update(`${email}\n${ip}`).digest('base64url');
    return {
      failures: `sign-in:failures:${id}`,
      lock: `sign-in:lock:${id}`,
      busy: `sign-in:busy:${id}`
    };
  };
  return {
    begin: async (email: string, ip: string) => {
      const { lock, busy } = keys(email, ip);
      const wait = await store.ttl(lock);
      if (wait > 0) return wait;
      return (await store.set(busy, '1', 'EX', BUSY_SECONDS, 'NX')) === null ? 1 : 0;
    },
    failed: async (email: string, ip: string) => {
      const { failures, lock, busy } = keys(email, ip);
      const n = await store.incr(failures);
      await store.expire(failures, WINDOW_SECONDS);
      const seconds = lockSeconds(n);
      if (seconds) await store.set(lock, String(n), 'EX', seconds);
      await store.del(busy);
    },
    succeeded: async (email: string, ip: string) => {
      const { failures, lock, busy } = keys(email, ip);
      await store.del(failures, lock, busy);
    }
  };
};

export type SignInThrottle = ReturnType<typeof createSignInThrottle>;
