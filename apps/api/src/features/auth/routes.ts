import { sValidator } from '@hono/standard-validator';
import { SESSION_COOKIE, SESSION_TTL_SECONDS, type SessionData } from '@ugula/auth';
import { type Context, Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { invalidRequest } from '../../shared/http.ts';
import { ok, type Result, respond } from '../../shared/result.ts';
import { acceptInvitationSchema, setPasswordSchema, signInSchema, tokenSchema } from './schemas.ts';
import type { AuthService } from './service.ts';

type AuthRoutesDeps = {
  service: AuthService;
  sseUrl: string;
  secureCookie: boolean;
  clientIp: (c: Context) => string;
};

export const createAuthRoutes = ({ service, sseUrl, secureCookie, clientIp }: AuthRoutesDeps) => {
  const app = new Hono();
  const sessionBody = async ({ userId }: SessionData) => {
    const me = await service.me(userId);
    return me.ok ? ok({ user: me.value, sseUrl }) : me;
  };
  const clearCookie = (c: Context) => deleteCookie(c, SESSION_COOKIE, { path: '/' });
  const startSession = (c: Context, token: string) =>
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: secureCookie,
      path: '/',
      maxAge: SESSION_TTL_SECONDS
    });

  const signedIn = async (c: Context, res: Result<{ token: string; session: SessionData }>) => {
    if (!res.ok) {
      const wait = res.failure.details?.retryAfter;
      if (typeof wait === 'number') c.header('retry-after', String(wait));
      return respond(c, res);
    }
    startSession(c, res.value.token);
    return respond(c, await sessionBody(res.value.session));
  };

  app.post('/sign-in', sValidator('json', signInSchema, invalidRequest), async (c) =>
    signedIn(c, await service.signIn(c.req.valid('json'), clientIp(c)))
  );

  app.post('/sign-out', async (c) => {
    await service.signOut(getCookie(c, SESSION_COOKIE));
    clearCookie(c);
    return respond(c, ok({ status: 'ok' }));
  });

  app.get('/me', async (c) => {
    const res = await service.session(getCookie(c, SESSION_COOKIE));
    if (!res.ok) clearCookie(c);
    return respond(c, res.ok ? await sessionBody(res.value) : res);
  });

  app.post('/invitation/preview', sValidator('json', tokenSchema, invalidRequest), async (c) =>
    respond(c, await service.previewInvitation(c.req.valid('json').token))
  );

  app.post(
    '/invitation/accept',
    sValidator('json', acceptInvitationSchema, invalidRequest),
    async (c) => signedIn(c, await service.acceptInvitation(c.req.valid('json'), clientIp(c)))
  );

  app.post('/password', sValidator('json', setPasswordSchema, invalidRequest), async (c) =>
    respond(c, await service.setPassword(c.req.valid('json')))
  );

  return app;
};
