import { sValidator } from '@hono/standard-validator';
import { Hono } from 'hono';
import { type AgencyEnv, requirePermission } from '../../shared/access.ts';
import { idParam, invalidRequest } from '../../shared/http.ts';
import { respond } from '../../shared/result.ts';
import { inviteSchema, listUsersQuery, updateUserSchema } from './schemas.ts';
import type { UserService } from './service.ts';

const id = sValidator('param', idParam, invalidRequest);

export const createUserRoutes = (service: UserService) =>
  new Hono<AgencyEnv>()
    .get(
      '/',
      requirePermission('users:read'),
      sValidator('query', listUsersQuery, invalidRequest),
      async (c) => respond(c, await service.list(c.get('access'), c.req.valid('query')))
    )
    .get('/:id', requirePermission('users:read'), id, async (c) =>
      respond(c, await service.find(c.get('access'), c.req.valid('param').id))
    )
    .put(
      '/:id',
      requirePermission('users:update'),
      id,
      sValidator('json', updateUserSchema, invalidRequest),
      async (c) =>
        respond(
          c,
          await service.update(c.get('access'), c.req.valid('param').id, c.req.valid('json'))
        )
    )
    .delete('/:id', requirePermission('users:delete'), id, async (c) =>
      respond(c, await service.remove(c.get('access'), c.req.valid('param').id))
    )
    .post('/:id/password-link', requirePermission('users:update'), id, async (c) =>
      respond(c, await service.passwordLink(c.get('access'), c.req.valid('param').id), 201)
    );

export const createInvitationRoutes = (service: UserService) =>
  new Hono<AgencyEnv>()
    .get('/', requirePermission('users:read'), async (c) =>
      respond(c, await service.invitations(c.get('access')))
    )
    .post(
      '/',
      requirePermission('users:create'),
      sValidator('json', inviteSchema, invalidRequest),
      async (c) => respond(c, await service.invite(c.get('access'), c.req.valid('json')), 201)
    )
    .post('/:id/resend', requirePermission('users:create'), id, async (c) =>
      respond(c, await service.resend(c.get('access'), c.req.valid('param').id), 201)
    )
    .delete('/:id', requirePermission('users:delete'), id, async (c) =>
      respond(c, await service.removeInvitation(c.get('access'), c.req.valid('param').id))
    );
