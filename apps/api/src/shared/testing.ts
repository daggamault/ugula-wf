import { PERMISSIONS, type Permission } from '@ugula/access';
import type { RedisLike, SessionStore } from '@ugula/auth';
import type { LiveEvent } from '@ugula/live';
import { Hono } from 'hono';
import type { AgencyAccess, AgencyEnv } from './access.ts';
import { requireAuth } from './auth.ts';
import type { Announce } from './live.ts';
import type { ThrottleStore } from './throttle.ts';

export const testSessions: SessionStore = {
  create: async () => 'test',
  get: async (token) => (token === 'test' ? { userId: 'u-1', email: 'dev@example.com' } : null),
  destroy: async () => undefined,
  destroyAll: async () => undefined
};

export const testAccess = (permissions: readonly Permission[] = PERMISSIONS): AgencyAccess => ({
  agencyId: 't-1',
  agencyName: 'Development',
  organizationId: 'o-1',
  organizationName: 'Development EMS',
  userId: 'u-1',
  isOrganizationAdmin: permissions === PERMISSIONS,
  permissions: [...permissions]
});

export const withSession = (routes: Hono<AgencyEnv>, access: AgencyAccess = testAccess()) => {
  const app = new Hono<AgencyEnv>()
    .use(requireAuth(async (token) => (token ? testSessions.get(token) : null)))
    .use(async (c, next) => {
      c.set('access', access);
      await next();
    })
    .route('/', routes);
  return (path: string, init: RequestInit = {}) =>
    app.request(path, {
      ...init,
      headers: {
        cookie: 'ugula_session=test',
        ...(typeof init.body === 'string' ? { 'content-type': 'application/json' } : {}),
        ...init.headers
      }
    });
};

export const recordAnnouncements = () => {
  const events: { agencyId: string; event: LiveEvent }[] = [];
  const announce: Announce = async (agencyId, event) => void events.push({ agencyId, event });
  return { announce, events };
};

export const memoryRedis = () => {
  const values = new Map<string, { value: string; ttl: number }>();
  const sets = new Map<string, Set<string>>();
  const redis: RedisLike & ThrottleStore = {
    get: async (k) => values.get(k)?.value ?? null,
    set: async (k, value, _mode, ttl) => void values.set(k, { value, ttl }),
    del: async (...keys) => {
      for (const k of keys) {
        values.delete(k);
        sets.delete(k);
      }
    },
    incr: async (k) => {
      const n = Number(values.get(k)?.value ?? 0) + 1;
      values.set(k, { value: String(n), ttl: values.get(k)?.ttl ?? -1 });
      return n;
    },
    expire: async (k, ttl) => {
      const entry = values.get(k);
      if (entry) values.set(k, { ...entry, ttl });
    },
    ttl: async (k) => values.get(k)?.ttl ?? -2,
    sadd: async (k, ...members) => void sets.set(k, new Set([...(sets.get(k) ?? []), ...members])),
    srem: async (k, ...members) => {
      for (const m of members) sets.get(k)?.delete(m);
    },
    smembers: async (k) => [...(sets.get(k) ?? [])]
  };
  return { redis, keys: () => [...values.keys(), ...sets.keys()] };
};
