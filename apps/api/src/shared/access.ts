import type { Permission } from '@ugula/access';
import type { SessionData } from '@ugula/auth';
import type { MiddlewareHandler } from 'hono';
import * as v from 'valibot';
import { uuid } from './http.ts';

export type AgencyAccess = {
  agencyId: string;
  agencyName: string;
  organizationId: string;
  organizationName: string;
  userId: string;
  isOrganizationAdmin: boolean;
  permissions: Permission[];
};

export type AgencyEnv = {
  Variables: {
    session: SessionData;
    access: AgencyAccess;
  };
};

export type FindAccess = (userId: string, agencyId: string) => Promise<AgencyAccess | null>;

const agencyParam = v.object({ agencyId: uuid });

export const requireAgencyAccess =
  (findAccess: FindAccess): MiddlewareHandler<AgencyEnv> =>
  async (c, next) => {
    const param = v.safeParse(agencyParam, { agencyId: c.req.param('agencyId') });
    const access = param.success
      ? await findAccess(c.get('session').userId, param.output.agencyId)
      : null;
    if (!access) return c.json({ error: 'Agency not found' }, 404);
    c.set('access', access);
    await next();
  };

export const hasPermission = (access: AgencyAccess, permission: Permission) =>
  access.permissions.includes(permission);

const forbidden = { error: 'You do not have permission to do this' };

export const requirePermission =
  (permission: Permission): MiddlewareHandler<AgencyEnv> =>
  async (c, next) => {
    if (!hasPermission(c.get('access'), permission)) return c.json(forbidden, 403);
    await next();
  };

type MethodPermissions = Partial<Record<'GET' | 'POST' | 'PUT' | 'DELETE', Permission | null>>;

export const guardMethods =
  (permissions: MethodPermissions): MiddlewareHandler<AgencyEnv> =>
  async (c, next) => {
    const method = c.req.method === 'HEAD' ? 'GET' : c.req.method;
    const permission = permissions[method as keyof MethodPermissions];
    if (permission === undefined) return c.json(forbidden, 403);
    if (permission !== null && !hasPermission(c.get('access'), permission)) {
      return c.json(forbidden, 403);
    }
    await next();
  };
