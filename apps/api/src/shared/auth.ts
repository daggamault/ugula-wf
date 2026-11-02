import { SESSION_COOKIE, type SessionData } from '@ugula/auth';
import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';

export type AuthEnv = {
  Variables: {
    session: SessionData;
  };
};

export type Authenticate = (token: string | undefined) => Promise<SessionData | null>;

export const requireAuth =
  (authenticate: Authenticate): MiddlewareHandler<AuthEnv> =>
  async (c, next) => {
    const session = await authenticate(getCookie(c, SESSION_COOKIE));
    if (!session) return c.json({ error: 'Unauthorized' }, 401);
    c.set('session', session);
    await next();
  };
