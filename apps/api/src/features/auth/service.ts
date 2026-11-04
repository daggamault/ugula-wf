import { type SessionData, type SessionStore, verifyPassword } from '@ugula/auth';
import type { Db } from '@ugula/db';
import { fail, ok, type Result } from '../../shared/result.ts';
import type { SignInThrottle } from '../../shared/throttle.ts';
import { findActiveUserByEmail, isActiveMember } from './queries.ts';
import type { SignInInput } from './schemas.ts';

type AuthServiceDeps = {
  db: Db;
  sessions: SessionStore;
  throttle: SignInThrottle;
};

type SignedIn = {
  token: string;
  session: SessionData;
};

const unauthorized = fail('unauthorized', 'Unauthorized');

export const createAuthService = ({ db, sessions, throttle }: AuthServiceDeps) => ({
  signIn: async ({ email, password }: SignInInput, ip: string): Promise<Result<SignedIn>> => {
    const wait = await throttle.retryAfter(email, ip);
    if (wait) {
      return fail('rate_limited', 'Too many failed sign-ins. Try again later.', {
        retryAfter: wait
      });
    }
    const user = await findActiveUserByEmail(db, email);
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      await throttle.failed(email, ip);
      return fail('unauthorized', 'Invalid email or password');
    }
    await throttle.succeeded(email, ip);
    const session = { userId: user.id, agencyId: user.agency_id, email: user.email };
    return ok({ token: await sessions.create(session), session });
  },
  session: async (token: string | undefined): Promise<Result<SessionData>> => {
    const session = token ? await sessions.get(token) : null;
    if (!token || !session) return unauthorized;
    if (!(await isActiveMember(db, session.userId, session.agencyId))) {
      await sessions.destroyAll(session.userId);
      return unauthorized;
    }
    return ok(session);
  },
  signOut: async (token: string | undefined) => {
    if (token) await sessions.destroy(token);
  }
});

export type AuthService = ReturnType<typeof createAuthService>;
