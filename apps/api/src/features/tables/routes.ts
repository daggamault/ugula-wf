import { sValidator } from '@hono/standard-validator';
import { Hono } from 'hono';
import type { AgencyEnv } from '../../shared/access.ts';
import { idParam, invalidRequest } from '../../shared/http.ts';
import { respond } from '../../shared/result.ts';
import {
  overrideTableSchema,
  searchTablesQuery,
  tableDefinitionSchema,
  tableVersionParam
} from './schemas.ts';
import type { TableService } from './service.ts';

export const createTableRoutes = (service: TableService) =>
  new Hono<AgencyEnv>()
    .get('/', sValidator('query', searchTablesQuery, invalidRequest), async (c) =>
      respond(c, await service.search(c.get('access'), c.req.valid('query')))
    )
    .get('/:id', sValidator('param', idParam, invalidRequest), async (c) =>
      respond(c, await service.find(c.get('access'), c.req.valid('param').id))
    )
    .get('/:id/compare', sValidator('param', idParam, invalidRequest), async (c) =>
      respond(c, await service.compare(c.get('access'), c.req.valid('param').id))
    )
    .get(
      '/:id/versions/:version',
      sValidator('param', tableVersionParam, invalidRequest),
      async (c) => {
        const { id, version } = c.req.valid('param');
        return respond(c, await service.version(c.get('access'), id, version));
      }
    )
    .put(
      '/:id/draft',
      sValidator('param', idParam, invalidRequest),
      sValidator('json', tableDefinitionSchema, invalidRequest),
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
      sValidator('json', overrideTableSchema, invalidRequest),
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
    .delete('/:id', sValidator('param', idParam, invalidRequest), async (c) =>
      respond(c, await service.remove(c.get('access'), c.req.valid('param').id))
    );
