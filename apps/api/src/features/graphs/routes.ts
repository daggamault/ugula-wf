import { sValidator } from '@hono/standard-validator';
import { Hono } from 'hono';
import type { AgencyEnv } from '../../shared/access.ts';
import { idParam, invalidRequest } from '../../shared/http.ts';
import { respond } from '../../shared/result.ts';
import {
  createGraphSchema,
  definitionSchema,
  overrideSchema,
  rebaseSchema,
  searchGraphsQuery,
  versionParam
} from './schemas.ts';
import type { GraphService } from './service.ts';

export const createGraphRoutes = (service: GraphService) =>
  new Hono<AgencyEnv>()
    .get('/', sValidator('query', searchGraphsQuery, invalidRequest), async (c) =>
      respond(c, await service.search(c.get('access'), c.req.valid('query')))
    )
    .get('/nodes', async (c) => respond(c, await service.nodes(c.get('access'))))
    .post('/validate', sValidator('json', definitionSchema, invalidRequest), async (c) =>
      respond(c, await service.validate(c.get('access'), c.req.valid('json').definition))
    )
    .post('/', sValidator('json', createGraphSchema, invalidRequest), async (c) =>
      respond(c, await service.create(c.get('access'), c.req.valid('json')), 201)
    )
    .get('/:id', sValidator('param', idParam, invalidRequest), async (c) =>
      respond(c, await service.find(c.get('access'), c.req.valid('param').id))
    )
    .get('/:id/compare', sValidator('param', idParam, invalidRequest), async (c) =>
      respond(c, await service.compare(c.get('access'), c.req.valid('param').id))
    )
    .get('/:id/versions/:version', sValidator('param', versionParam, invalidRequest), async (c) => {
      const { id, version } = c.req.valid('param');
      return respond(c, await service.version(c.get('access'), id, version));
    })
    .put(
      '/:id/draft',
      sValidator('param', idParam, invalidRequest),
      sValidator('json', definitionSchema, invalidRequest),
      async (c) =>
        respond(
          c,
          await service.saveDraft(
            c.get('access'),
            c.req.valid('param').id,
            c.req.valid('json').definition
          )
        )
    )
    .post('/:id/publish', sValidator('param', idParam, invalidRequest), async (c) =>
      respond(c, await service.publish(c.get('access'), c.req.valid('param').id))
    )
    .post(
      '/:id/override',
      sValidator('param', idParam, invalidRequest),
      sValidator('json', overrideSchema, invalidRequest),
      async (c) =>
        respond(
          c,
          await service.override(
            c.get('access'),
            c.req.valid('param').id,
            c.req.valid('json').scope
          ),
          201
        )
    )
    .post(
      '/:id/rebase',
      sValidator('param', idParam, invalidRequest),
      sValidator('json', rebaseSchema, invalidRequest),
      async (c) =>
        respond(
          c,
          await service.rebase(c.get('access'), c.req.valid('param').id, c.req.valid('json').mode)
        )
    )
    .delete('/:id', sValidator('param', idParam, invalidRequest), async (c) =>
      respond(c, await service.remove(c.get('access'), c.req.valid('param').id))
    );
