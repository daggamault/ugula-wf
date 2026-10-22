import { randomBytes } from 'node:crypto';
import { emailString, nonEmpty } from '@ugula/config';
import * as v from 'valibot';

export const SESSION_COOKIE = 'ugula_session';
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export const sessionDataSchema = v.object({
  userId: nonEmpty,
  tenantId: nonEmpty,
  email: emailString
});

export type SessionData = v.InferOutput<typeof sessionDataSchema>;

export type RedisLike = {
  set: (key: string, value: string, mode: 'EX', ttl: number) => Promise<unknown>;
  get: (key: string) => Promise<string | null>;
  del: (...keys: string[]) => Promise<unknown>;
};

export type SessionStore = {
  create: (data: SessionData) => Promise<string>;
  get: (token: string) => Promise<SessionData | null>;
  destroy: (token: string) => Promise<void>;
};

const sessionKey = (token: string) => `session:${token}`;

export const createSessionStore = (
  redis: RedisLike,
  ttlSeconds = SESSION_TTL_SECONDS
): SessionStore => ({
  create: async (data) => {
    const token = randomBytes(32).toString('base64url');
    await redis.set(sessionKey(token), JSON.stringify(data), 'EX', ttlSeconds);
    return token;
  },
  get: async (token) => {
    const raw = await redis.get(sessionKey(token));
    if (!raw) return null;
    try {
      const parsed = v.safeParse(sessionDataSchema, JSON.parse(raw));
      return parsed.success ? parsed.output : null;
    } catch {
      return null;
    }
  },
  destroy: async (token) => {
    await redis.del(sessionKey(token));
  }
});
