import { sValidator } from '@hono/standard-validator';
import { Hono } from 'hono';
import type { AuthEnv } from '../../shared/auth.ts';
import { idParam, invalidRequest } from '../../shared/http.ts';
import { respond } from '../../shared/result.ts';
import { createGraphSchema, definitionSchema, searchGraphsQuery, versionParam } from './schemas.ts';
import type { GraphService } from './service.ts';

export const createGraphRoutes = (service: GraphService) =>
  new Hono<AuthEnv>()
    .get('/', sValidator('query', searchGraphsQuery, invalidRequest), async (c) =>
      respond(c, await service.search(c.get('session').agencyId, c.req.valid('query')))
    )
    .get('/nodes', async (c) => respond(c, await service.nodes(c.get('session').agencyId)))
    .post('/validate', sValidator('json', definitionSchema, invalidRequest), async (c) =>
      respond(c, await service.validate(c.get('session').agencyId, c.req.valid('json').definition))
    )
    .post('/', sValidator('json', createGraphSchema, invalidRequest), async (c) => {
      const { agencyId, userId } = c.get('session');
      return respond(c, await service.create(agencyId, userId, c.req.valid('json')), 201);
    })
    .get('/:id', sValidator('param', idParam, invalidRequest), async (c) =>
      respond(c, await service.find(c.get('session').agencyId, c.req.valid('param').id))
    )
    .get('/:id/versions/:version', sValidator('param', versionParam, invalidRequest), async (c) => {
      const { id, version } = c.req.valid('param');
      return respond(c, await service.version(c.get('session').agencyId, id, version));
    })
    .put(
      '/:id/draft',
      sValidator('param', idParam, invalidRequest),
      sValidator('json', definitionSchema, invalidRequest),
      async (c) => {
        const { agencyId, userId } = c.get('session');
        const { id } = c.req.valid('param');
        return respond(
          c,
          await service.saveDraft(agencyId, userId, id, c.req.valid('json').definition)
        );
      }
    )
    .post('/:id/publish', sValidator('param', idParam, invalidRequest), async (c) =>
      respond(c, await service.publish(c.get('session').agencyId, c.req.valid('param').id))
    )
    .post('/:id/override', sValidator('param', idParam, invalidRequest), async (c) => {
      const { agencyId, userId } = c.get('session');
      return respond(c, await service.override(agencyId, userId, c.req.valid('param').id), 201);
    })
    .delete('/:id', sValidator('param', idParam, invalidRequest), async (c) =>
      respond(c, await service.remove(c.get('session').agencyId, c.req.valid('param').id))
    );
