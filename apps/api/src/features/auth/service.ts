import {
  hashPassword,
  hashToken,
  type SessionData,
  type SessionStore,
  verifyPassword
} from '@ugula/auth';
import type { Db } from '@ugula/db';
import { fail, ok, type Result } from '../../shared/result.ts';
import type { SignInThrottle } from '../../shared/throttle.ts';
import {
  consumePasswordToken,
  deleteInvitationById,
  findActiveUser,
  findActiveUserByEmail,
  findInvitationByHash,
  insertMembership,
  insertOrganizationUser,
  setUserPassword
} from './queries.ts';
import type { AcceptInvitationInput, SignInInput } from './schemas.ts';

type AuthServiceDeps = {
  db: Db;
  sessions: SessionStore;
  throttle: SignInThrottle;
  now?: () => Date;
};

export type CurrentUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  type: 'platform' | 'organization';
  isOwner: boolean;
  organizationId: string | null;
  organizationName: string | null;
};

type SignedIn = {
  token: string;
  session: SessionData;
};

const unauthorized = fail('unauthorized', 'Unauthorized');

const invalidToken = fail('invalid', 'This link is invalid or has expired');

export const createAuthService = ({
  db,
  sessions,
  throttle,
  now = () => new Date()
}: AuthServiceDeps) => ({
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
    const session = { userId: user.id, email: user.email };
    return ok({ token: await sessions.create(session), session });
  },
  session: async (token: string | undefined): Promise<Result<SessionData>> => {
    const session = token ? await sessions.get(token) : null;
    if (!token || !session) return unauthorized;
    if (!(await findActiveUser(db, session.userId))) {
      await sessions.destroyAll(session.userId);
      return unauthorized;
    }
    return ok(session);
  },
  me: async (userId: string): Promise<Result<CurrentUser>> => {
    const u = await findActiveUser(db, userId);
    return u
      ? ok({
          id: u.id,
          email: u.email,
          firstName: u.first_name,
          lastName: u.last_name,
          type: u.type,
          isOwner: u.is_owner,
          organizationId: u.organization_id,
          organizationName: u.organization_name
        })
      : unauthorized;
  },
  signOut: async (token: string | undefined) => {
    if (token) await sessions.destroy(token);
  },
  previewInvitation: async (token: string) => {
    const i = await findInvitationByHash(db, hashToken(token));
    if (!i || i.expires_at.getTime() <= now().getTime()) return invalidToken;
    if (i.user_id && (i.user_organization_id !== i.organization_id || !i.user_active)) {
      return invalidToken;
    }
    return ok({
      email: i.email,
      firstName: i.first_name,
      lastName: i.last_name,
      agencyName: i.agency_name,
      organizationName: i.organization_name,
      roleName: i.role_name,
      hasAccount: i.user_id !== null
    });
  },
  acceptInvitation: async ({
    token,
    password
  }: AcceptInvitationInput): Promise<Result<SignedIn>> => {
    const i = await findInvitationByHash(db, hashToken(token));
    if (!i || i.expires_at.getTime() <= now().getTime()) return invalidToken;
    if (i.user_id && (i.user_organization_id !== i.organization_id || !i.user_active)) {
      return invalidToken;
    }
    if (i.password_hash && !(await verifyPassword(password, i.password_hash))) {
      return fail('unauthorized', 'Invalid email or password');
    }
    if (!i.user_id && password.length < 12) {
      return fail('invalid', 'Use at least 12 characters');
    }
    const passwordHash = i.user_id ? null : await hashPassword(password);
    const userId = await db.transaction().execute(async (tx) => {
      const id =
        i.user_id ??
        (
          await insertOrganizationUser(tx, {
            organizationId: i.organization_id,
            email: i.email,
            firstName: i.first_name,
            lastName: i.last_name,
            passwordHash: passwordHash ?? ''
          })
        ).id;
      await insertMembership(tx, {
        organizationId: i.organization_id,
        agencyId: i.agency_id,
        userId: id,
        roleId: i.role_id
      });
      await deleteInvitationById(tx, i.id);
      return id;
    });
    const session = { userId, email: i.email };
    return ok({ token: await sessions.create(session), session });
  },
  setPassword: async ({ token, password }: { token: string; password: string }) => {
    const passwordHash = await hashPassword(password);
    const userId = await db.transaction().execute(async (tx) => {
      const found = await consumePasswordToken(tx, hashToken(token), now());
      if (found) await setUserPassword(tx, found.user_id, passwordHash);
      return found?.user_id;
    });
    if (!userId) return invalidToken;
    await sessions.destroyAll(userId);
    return ok({ status: 'ok' });
  }
});

export type AuthService = ReturnType<typeof createAuthService>;
