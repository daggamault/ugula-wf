import { sValidator } from '@hono/standard-validator';
import { Hono } from 'hono';
import type { AuthEnv } from '../../shared/auth.ts';
import { idParam, invalidRequest } from '../../shared/http.ts';
import { respond } from '../../shared/result.ts';
import { createGraphSchema, definitionSchema, versionParam } from './schemas.ts';
import type { GraphService } from './service.ts';

export const createGraphRoutes = (service: GraphService) =>
  new Hono<AuthEnv>()
    .get('/', async (c) => respond(c, await service.list(c.get('session').tenantId)))
    .get('/nodes', async (c) => respond(c, await service.nodes(c.get('session').tenantId)))
    .post('/validate', sValidator('json', definitionSchema, invalidRequest), async (c) =>
      respond(c, await service.validate(c.get('session').tenantId, c.req.valid('json').definition))
    )
    .post('/', sValidator('json', createGraphSchema, invalidRequest), async (c) => {
      const { tenantId, userId } = c.get('session');
      return respond(c, await service.create(tenantId, userId, c.req.valid('json')), 201);
    })
    .get('/:id', sValidator('param', idParam, invalidRequest), async (c) =>
      respond(c, await service.find(c.get('session').tenantId, c.req.valid('param').id))
    )
    .get('/:id/versions/:version', sValidator('param', versionParam, invalidRequest), async (c) => {
      const { id, version } = c.req.valid('param');
      return respond(c, await service.version(c.get('session').tenantId, id, version));
    })
    .put(
      '/:id/draft',
      sValidator('param', idParam, invalidRequest),
      sValidator('json', definitionSchema, invalidRequest),
      async (c) => {
        const { tenantId, userId } = c.get('session');
        const { id } = c.req.valid('param');
        return respond(
          c,
          await service.saveDraft(tenantId, userId, id, c.req.valid('json').definition)
        );
      }
    )
    .post('/:id/publish', sValidator('param', idParam, invalidRequest), async (c) =>
      respond(c, await service.publish(c.get('session').tenantId, c.req.valid('param').id))
    );
