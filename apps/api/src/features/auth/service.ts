import { randomBytes } from 'node:crypto';
import { isLongEnoughPassword, PASSWORD_TOO_SHORT } from '@ugula/access';
import {
  hashPassword,
  hashToken,
  type SessionData,
  type SessionStore,
  verifyPassword
} from '@ugula/auth';
import type { Db } from '@ugula/db';
import { isUniqueViolation } from '../../shared/http.ts';
import { fail, ok, type Result } from '../../shared/result.ts';
import type { SignInThrottle } from '../../shared/throttle.ts';
import {
  consumeInvitation,
  consumePasswordToken,
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

type Invitation = NonNullable<Awaited<ReturnType<typeof findInvitationByHash>>>;

type Joiner = { userId: string } | { passwordHash: string };

const unauthorized = fail('unauthorized', 'Unauthorized');

const badCredentials = fail('unauthorized', 'Invalid email or password');

const invalidToken = fail('invalid', 'This link is invalid or has expired');

const rateLimited = (retryAfter: number) =>
  fail('rate_limited', 'Too many failed sign-ins. Try again later.', { retryAfter });

const isUsableInvitation = (i: Invitation, at: Date) =>
  i.expires_at.getTime() > at.getTime() &&
  (i.user_id === null || (i.user_organization_id === i.organization_id && i.user_active === true));

export const createAuthService = ({
  db,
  sessions,
  throttle,
  now = () => new Date()
}: AuthServiceDeps) => {
  let dummy: Promise<string> | null = null;
  const dummyHash = () => {
    dummy ??= hashPassword(randomBytes(16).toString('hex'));
    return dummy;
  };
  const checkPassword = async (
    email: string,
    ip: string,
    password: string,
    hash: string | null | undefined
  ) => {
    const valid = await verifyPassword(password, hash ?? (await dummyHash()));
    if (valid && hash) await throttle.succeeded(email, ip);
    else await throttle.failed(email, ip);
    return valid && Boolean(hash);
  };
  const startSession = async (session: SessionData) =>
    ok({ token: await sessions.create(session), session });
  const usableInvitation = async (token: string) => {
    const i = await findInvitationByHash(db, hashToken(token));
    return i && isUsableInvitation(i, now()) ? i : null;
  };
  const join = async (i: Invitation, token: string, joiner: Joiner) => {
    try {
      return await db.transaction().execute(async (tx): Promise<Result<string>> => {
        if (!(await consumeInvitation(tx, i.id, hashToken(token), now()))) return invalidToken;
        const userId =
          'userId' in joiner
            ? joiner.userId
            : (
                await insertOrganizationUser(tx, {
                  organizationId: i.organization_id,
                  email: i.email,
                  firstName: i.first_name,
                  lastName: i.last_name,
                  passwordHash: joiner.passwordHash
                })
              ).id;
        const joined = await insertMembership(tx, {
          organizationId: i.organization_id,
          agencyId: i.agency_id,
          userId,
          roleId: i.role_id
        });
        return joined ? ok(userId) : fail('conflict', 'You already belong to this agency');
      });
    } catch (err) {
      if (isUniqueViolation(err)) return invalidToken;
      throw err;
    }
  };
  return {
    signIn: async ({ email, password }: SignInInput, ip: string): Promise<Result<SignedIn>> => {
      const wait = await throttle.retryAfter(email, ip);
      if (wait) return rateLimited(wait);
      const user = await findActiveUserByEmail(db, email);
      if (!(await checkPassword(email, ip, password, user?.password_hash)) || !user) {
        return badCredentials;
      }
      return startSession({ userId: user.id, email: user.email });
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
      const i = await usableInvitation(token);
      return i
        ? ok({
            email: i.email,
            firstName: i.first_name,
            lastName: i.last_name,
            agencyName: i.agency_name,
            organizationName: i.organization_name,
            roleName: i.role_name,
            hasAccount: i.user_id !== null
          })
        : invalidToken;
    },
    acceptInvitation: async (
      { token, password }: AcceptInvitationInput,
      ip: string
    ): Promise<Result<SignedIn>> => {
      const i = await usableInvitation(token);
      if (!i) return invalidToken;
      if (i.user_id) {
        const wait = await throttle.retryAfter(i.email, ip);
        if (wait) return rateLimited(wait);
        if (!(await checkPassword(i.email, ip, password, i.password_hash))) return badCredentials;
      } else if (!isLongEnoughPassword(password)) {
        return fail('invalid', PASSWORD_TOO_SHORT);
      }
      const joined = await join(
        i,
        token,
        i.user_id ? { userId: i.user_id } : { passwordHash: await hashPassword(password) }
      );
      return joined.ok ? startSession({ userId: joined.value, email: i.email }) : joined;
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
  };
};

export type AuthService = ReturnType<typeof createAuthService>;
