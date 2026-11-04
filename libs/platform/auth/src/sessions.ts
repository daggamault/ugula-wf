import { randomBytes } from 'node:crypto';
import * as v from 'valibot';

export const SESSION_COOKIE = 'ugula_session';
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

const nonEmpty = v.pipe(v.string(), v.nonEmpty());

const sessionDataSchema = v.object({
  userId: nonEmpty,
  agencyId: nonEmpty,
  email: v.pipe(nonEmpty, v.email())
});

export type SessionData = v.InferOutput<typeof sessionDataSchema>;

export type RedisLike = {
  set: (key: string, value: string, mode: 'EX', ttl: number) => Promise<unknown>;
  get: (key: string) => Promise<string | null>;
  del: (...keys: string[]) => Promise<unknown>;
  sadd: (key: string, ...members: string[]) => Promise<unknown>;
  srem: (key: string, ...members: string[]) => Promise<unknown>;
  smembers: (key: string) => Promise<string[]>;
  expire: (key: string, seconds: number) => Promise<unknown>;
};

export type SessionStore = {
  create: (data: SessionData) => Promise<string>;
  get: (token: string) => Promise<SessionData | null>;
  destroy: (token: string) => Promise<void>;
  destroyAll: (userId: string) => Promise<void>;
};

export const readCookie = (header: string | undefined, name: string) => {
  for (const part of (header ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key !== name) continue;
    try {
      return decodeURIComponent(value.join('='));
    } catch {
      return undefined;
    }
  }
  return undefined;
};

const sessionKey = (token: string) => `session:${token}`;

const userKey = (userId: string) => `user-sessions:${userId}`;

const parseSession = (raw: string | null) => {
  if (!raw) return null;
  try {
    const parsed = v.safeParse(sessionDataSchema, JSON.parse(raw));
    return parsed.success ? parsed.output : null;
  } catch {
    return null;
  }
};

export const createSessionStore = (
  redis: RedisLike,
  ttlSeconds = SESSION_TTL_SECONDS
): SessionStore => ({
  create: async (data) => {
    const token = randomBytes(32).toString('base64url');
    await redis.set(sessionKey(token), JSON.stringify(data), 'EX', ttlSeconds);
    await redis.sadd(userKey(data.userId), token);
    await redis.expire(userKey(data.userId), ttlSeconds);
    return token;
  },
  get: async (token) => parseSession(await redis.get(sessionKey(token))),
  destroy: async (token) => {
    const session = parseSession(await redis.get(sessionKey(token)));
    await redis.del(sessionKey(token));
    if (session) await redis.srem(userKey(session.userId), token);
  },
  destroyAll: async (userId) => {
    const tokens = await redis.smembers(userKey(userId));
    await redis.del(userKey(userId), ...tokens.map(sessionKey));
  }
});
