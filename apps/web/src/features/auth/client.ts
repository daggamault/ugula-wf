import { emailString, nonEmpty, urlString } from '@ugula/config';
import * as v from 'valibot';

export const authUserSchema = v.object({
  id: nonEmpty,
  tenantId: nonEmpty,
  email: emailString
});

export const authSessionSchema = v.object({
  user: authUserSchema,
  sseUrl: urlString
});

const errorBodySchema = v.object({
  error: nonEmpty
});

export type AuthUser = v.InferOutput<typeof authUserSchema>;
export type AuthSession = v.InferOutput<typeof authSessionSchema>;

export type AuthClient = {
  signIn: (email: string, password: string) => Promise<AuthSession>;
  signOut: () => Promise<void>;
  getMe: () => Promise<AuthSession | null>;
};

export const createAuthClient = (apiUrl: string, fetchFn: typeof fetch = fetch): AuthClient => ({
  signIn: async (email, password) => {
    const res = await fetchFn(`${apiUrl}/api/auth/sign-in`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    if (!res.ok) {
      const body = v.parse(errorBodySchema, await res.json());
      throw new Error(body.error);
    }
    return v.parse(authSessionSchema, await res.json());
  },
  signOut: async () => {
    const res = await fetchFn(`${apiUrl}/api/auth/sign-out`, {
      method: 'POST',
      credentials: 'include'
    });
    if (!res.ok) {
      throw new Error(`Sign out failed with status ${res.status}`);
    }
  },
  getMe: async () => {
    const res = await fetchFn(`${apiUrl}/api/auth/me`, {
      credentials: 'include'
    });
    if (!res.ok) return null;
    return v.parse(authSessionSchema, await res.json());
  }
});
