import { sValidator } from '@hono/standard-validator';
import { Hono } from 'hono';
import type { AgencyEnv } from '../../shared/access.ts';
import { idParam, invalidRequest } from '../../shared/http.ts';
import { respond } from '../../shared/result.ts';
import { aliasParams, payerNamesQuery, payerSchema, searchPayersQuery } from './schemas.ts';
import type { PayerService } from './service.ts';

export const createPayerRoutes = (service: PayerService) =>
  new Hono<AgencyEnv>()
    .get('/', sValidator('query', searchPayersQuery, invalidRequest), async (c) =>
      respond(c, await service.search(c.get('access').agencyId, c.req.valid('query')))
    )
    .get('/names', sValidator('query', payerNamesQuery, invalidRequest), async (c) =>
      respond(c, await service.names(c.get('access').agencyId, c.req.valid('query').q))
    )
    .get('/:id', sValidator('param', idParam, invalidRequest), async (c) =>
      respond(c, await service.find(c.get('access').agencyId, c.req.valid('param').id))
    )
    .put('/', sValidator('json', payerSchema, invalidRequest), async (c) =>
      respond(c, await service.save(c.get('access').agencyId, c.req.valid('json')))
    )
    .delete('/:id', sValidator('param', idParam, invalidRequest), async (c) =>
      respond(c, await service.remove(c.get('access').agencyId, c.req.valid('param').id))
    )
    .delete(
      '/:id/aliases/:aliasId',
      sValidator('param', aliasParams, invalidRequest),
      async (c) => {
        const { id, aliasId } = c.req.valid('param');
        return respond(c, await service.forget(c.get('access').agencyId, id, aliasId));
      }
    );
