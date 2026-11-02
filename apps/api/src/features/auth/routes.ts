import { sValidator } from '@hono/standard-validator';
import { SESSION_COOKIE, SESSION_TTL_SECONDS, type SessionData } from '@ugula/auth';
import { type Context, Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { invalidRequest } from '../../shared/http.ts';
import { ok, respond } from '../../shared/result.ts';
import { signInSchema } from './schemas.ts';
import type { AuthService } from './service.ts';

export type AuthRoutesDeps = {
  service: AuthService;
  sseUrl: string;
  secureCookie: boolean;
};

export const createAuthRoutes = ({ service, sseUrl, secureCookie }: AuthRoutesDeps) => {
  const app = new Hono();

  const sessionBody = ({ userId, tenantId, email }: SessionData) => ({
    user: { id: userId, tenantId, email },
    sseUrl
  });

  const clearCookie = (c: Context) => deleteCookie(c, SESSION_COOKIE, { path: '/' });

  app.post('/sign-in', sValidator('json', signInSchema, invalidRequest), async (c) => {
    const res = await service.signIn(c.req.valid('json'));
    if (!res.ok) return respond(c, res);
    setCookie(c, SESSION_COOKIE, res.value.token, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: secureCookie,
      path: '/',
      maxAge: SESSION_TTL_SECONDS
    });
    return respond(c, ok(sessionBody(res.value.session)));
  });

  app.post('/sign-out', async (c) => {
    await service.signOut(getCookie(c, SESSION_COOKIE));
    clearCookie(c);
    return respond(c, ok({ status: 'ok' }));
  });

  app.get('/me', async (c) => {
    const res = await service.session(getCookie(c, SESSION_COOKIE));
    if (!res.ok) clearCookie(c);
    return respond(c, res.ok ? ok(sessionBody(res.value)) : res);
  });

  return app;
};
