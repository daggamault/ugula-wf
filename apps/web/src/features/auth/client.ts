import { emailString, nonEmpty, urlString } from '@ugula/config';
import * as v from 'valibot';
import { type Api, isApiError } from '../../shared/api.ts';
import type { Signal } from '../../shared/signal.ts';

const authUserSchema = v.object({
  id: nonEmpty,
  email: emailString,
  firstName: v.string(),
  lastName: v.string(),
  type: v.picklist(['platform', 'organization']),
  isOwner: v.boolean(),
  organizationId: v.nullable(v.string()),
  organizationName: v.nullable(v.string())
});

const authSessionSchema = v.object({
  user: authUserSchema,
  sseUrl: urlString
});

export type AuthSession = v.InferOutput<typeof authSessionSchema>;

export type AuthClient = {
  signIn: (email: string, password: string) => Promise<AuthSession>;
  signOut: () => Promise<void>;
  getMe: () => Promise<AuthSession | null>;
  onExpired: (listener: () => void) => () => void;
  previewInvitation: (token: string) => Promise<InvitationPreview>;
  acceptInvitation: (token: string, password: string) => Promise<AuthSession>;
  setPassword: (token: string, password: string) => Promise<void>;
};

export type InvitationPreview = {
  email: string;
  firstName: string;
  lastName: string;
  agencyName: string;
  organizationName: string;
  roleName: string;
  hasAccount: boolean;
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
  onExpired: expired.subscribe,
  previewInvitation: (token) =>
    api.get<InvitationPreview>(`/api/auth/invitation?token=${encodeURIComponent(token)}`),
  acceptInvitation: async (token, password) =>
    v.parse(authSessionSchema, await api.post('/api/auth/invitation/accept', { token, password })),
  setPassword: async (token, password) => {
    await api.post('/api/auth/password', { token, password });
  }
});
