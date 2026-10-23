import type { SessionStore } from '@ugula/sessions';
import { Hono } from 'hono';
import { type AuthEnv, requireAuth } from './auth.ts';

export const testSessions: SessionStore = {
  create: async () => 'test',
  get: async (token) =>
    token === 'test' ? { userId: 'u-1', tenantId: 't-1', email: 'dev@example.com' } : null,
  destroy: async () => undefined
};

export const withSession = (routes: Hono<AuthEnv>) => {
  const app = new Hono<AuthEnv>().use(requireAuth(testSessions)).route('/', routes);
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
