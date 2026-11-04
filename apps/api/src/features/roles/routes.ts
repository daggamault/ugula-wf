import { sValidator } from '@hono/standard-validator';
import { Hono } from 'hono';
import { type AgencyEnv, requirePermission } from '../../shared/access.ts';
import { idParam, invalidRequest } from '../../shared/http.ts';
import { respond } from '../../shared/result.ts';
import { createRoleSchema, listRolesQuery, updateRoleSchema } from './schemas.ts';
import type { RoleService } from './service.ts';

export const createRoleRoutes = (service: RoleService) =>
  new Hono<AgencyEnv>()
    .get(
      '/',
      requirePermission('roles:read'),
      sValidator('query', listRolesQuery, invalidRequest),
      async (c) => respond(c, await service.list(c.get('access'), c.req.valid('query')))
    )
    .get('/permissions', requirePermission('roles:read'), (c) =>
      respond(c, service.permissions(c.get('access')))
    )
    .get(
      '/:id',
      requirePermission('roles:read'),
      sValidator('param', idParam, invalidRequest),
      async (c) => respond(c, await service.find(c.get('access'), c.req.valid('param').id))
    )
    .post(
      '/',
      requirePermission('roles:create'),
      sValidator('json', createRoleSchema, invalidRequest),
      async (c) => respond(c, await service.create(c.get('access'), c.req.valid('json')), 201)
    )
    .put(
      '/:id',
      requirePermission('roles:update'),
      sValidator('param', idParam, invalidRequest),
      sValidator('json', updateRoleSchema, invalidRequest),
      async (c) =>
        respond(
          c,
          await service.update(c.get('access'), c.req.valid('param').id, c.req.valid('json'))
        )
    )
    .delete(
      '/:id',
      requirePermission('roles:delete'),
      sValidator('param', idParam, invalidRequest),
      async (c) => respond(c, await service.remove(c.get('access'), c.req.valid('param').id))
    );
