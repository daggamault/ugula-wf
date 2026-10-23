import { SESSION_COOKIE, type SessionData, type SessionStore } from '@ugula/sessions';
import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';

export type AuthEnv = {
  Variables: {
    session: SessionData;
  };
};

export const requireAuth =
  (sessions: SessionStore): MiddlewareHandler<AuthEnv> =>
  async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE);
    const session = token ? await sessions.get(token) : null;
    if (!session) return c.json({ error: 'Unauthorized' }, 401);
    c.set('session', session);
    await next();
  };
