import type { Db } from '@ugula/db';
import { verifyPassword } from '@ugula/passwords';
import type { SessionData, SessionStore } from '@ugula/sessions';
import { fail, ok, type Result } from '../../shared/result.ts';
import { findActiveUserByEmail, isActiveMember } from './queries.ts';
import type { SignInInput } from './schemas.ts';

export type AuthServiceDeps = {
  db: Db;
  sessions: SessionStore;
};

export type SignedIn = {
  token: string;
  session: SessionData;
};

const unauthorized = fail('unauthorized', 'Unauthorized');

export const createAuthService = ({ db, sessions }: AuthServiceDeps) => ({
  signIn: async ({ email, password }: SignInInput): Promise<Result<SignedIn>> => {
    const user = await findActiveUserByEmail(db, email);
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return fail('unauthorized', 'Invalid email or password');
    }
    const session = { userId: user.id, tenantId: user.tenant_id, email: user.email };
    return ok({ token: await sessions.create(session), session });
  },

  session: async (token: string | undefined): Promise<Result<SessionData>> => {
    const session = token ? await sessions.get(token) : null;
    if (!token || !session) return unauthorized;
    if (!(await isActiveMember(db, session.userId, session.tenantId))) {
      await sessions.destroy(token);
      return unauthorized;
    }
    return ok(session);
  },

  signOut: async (token: string | undefined) => {
    if (token) await sessions.destroy(token);
  }
});

export type AuthService = ReturnType<typeof createAuthService>;
