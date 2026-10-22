import { sValidator } from '@hono/standard-validator';
import { verifyPassword } from '@ugula/passwords';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { SESSION_COOKIE, SESSION_TTL_SECONDS, type SessionStore } from '../../shared/session.ts';
import type { AuthUserRecord } from './queries.ts';
import { signInSchema } from './schemas.ts';

export type AuthRoutesDeps = {
  findUserByEmail: (email: string) => Promise<AuthUserRecord | undefined>;
  sessions: SessionStore;
  sseUrl: string;
  secureCookie: boolean;
};

export const createAuthRoutes = (deps: AuthRoutesDeps) => {
  const app = new Hono();

  app.post('/sign-in', sValidator('json', signInSchema), async (c) => {
    const { email, password } = c.req.valid('json');
    const user = await deps.findUserByEmail(email);

    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return c.json({ error: 'Invalid email or password' }, 401);
    }

    const token = await deps.sessions.create({
      userId: user.id,
      tenantId: user.tenant_id,
      email: user.email
    });

    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: deps.secureCookie,
      path: '/',
      maxAge: SESSION_TTL_SECONDS
    });

    return c.json({
      user: {
        id: user.id,
        tenantId: user.tenant_id,
        email: user.email
      },
      sseUrl: deps.sseUrl
    });
  });

  app.post('/sign-out', async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) {
      await deps.sessions.destroy(token);
    }
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ status: 'ok' });
  });

  app.get('/me', async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (!token) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const session = await deps.sessions.get(token);
    if (!session) {
      deleteCookie(c, SESSION_COOKIE, { path: '/' });
      return c.json({ error: 'Unauthorized' }, 401);
    }

    return c.json({
      user: {
        id: session.userId,
        tenantId: session.tenantId,
        email: session.email
      },
      sseUrl: deps.sseUrl
    });
  });

  return app;
};
