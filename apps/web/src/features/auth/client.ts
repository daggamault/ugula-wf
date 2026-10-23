import { emailString, nonEmpty, urlString } from '@ugula/config';
import * as v from 'valibot';
import { type Api, isApiError } from '../../shared/api.ts';
import type { Signal } from '../../shared/signal.ts';

export const authUserSchema = v.object({
  id: nonEmpty,
  tenantId: nonEmpty,
  email: emailString
});

export const authSessionSchema = v.object({
  user: authUserSchema,
  sseUrl: urlString
});

export type AuthSession = v.InferOutput<typeof authSessionSchema>;

export type AuthClient = {
  signIn: (email: string, password: string) => Promise<AuthSession>;
  signOut: () => Promise<void>;
  getMe: () => Promise<AuthSession | null>;
  onExpired: (listener: () => void) => () => void;
};

export const createAuthClient = (api: Api, expired: Pick<Signal, 'subscribe'>): AuthClient => ({
  signIn: async (email, password) =>
    v.parse(authSessionSchema, await api.post('/api/auth/sign-in', { email, password })),
  signOut: async () => {
    await api.post('/api/auth/sign-out');
  },
  getMe: async () => {
    try {
      return v.parse(authSessionSchema, await api.get('/api/auth/me'));
    } catch (err) {
      if (isApiError(err) && err.status === 401) return null;
      throw err;
    }
  },
  onExpired: expired.subscribe
});
