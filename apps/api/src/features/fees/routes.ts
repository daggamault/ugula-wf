import { sValidator } from '@hono/standard-validator';
import { Hono } from 'hono';
import type { AgencyEnv } from '../../shared/access.ts';
import { idParam, invalidRequest } from '../../shared/http.ts';
import { respond } from '../../shared/result.ts';
import { feeSchema, searchFeesQuery } from './schemas.ts';
import type { FeeService } from './service.ts';

export const createFeeRoutes = (service: FeeService) =>
  new Hono<AgencyEnv>()
    .get('/', sValidator('query', searchFeesQuery, invalidRequest), async (c) =>
      respond(c, await service.search(c.get('access').agencyId, c.req.valid('query')))
    )
    .get('/:id', sValidator('param', idParam, invalidRequest), async (c) =>
      respond(c, await service.find(c.get('access').agencyId, c.req.valid('param').id))
    )
    .put('/', sValidator('json', feeSchema, invalidRequest), async (c) =>
      respond(c, await service.save(c.get('access').agencyId, c.req.valid('json')))
    )
    .delete('/:id', sValidator('param', idParam, invalidRequest), async (c) =>
      respond(c, await service.remove(c.get('access').agencyId, c.req.valid('param').id))
    );
