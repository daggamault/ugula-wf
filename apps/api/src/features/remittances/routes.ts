import { sValidator } from '@hono/standard-validator';
import { Hono } from 'hono';
import type { AgencyEnv } from '../../shared/access.ts';
import { idParam, invalidRequest } from '../../shared/http.ts';
import { respond } from '../../shared/result.ts';
import { searchRemittancesQuery } from './schemas.ts';
import type { RemittanceService } from './service.ts';

export const createRemittanceRoutes = (service: RemittanceService) =>
  new Hono<AgencyEnv>()
    .get('/', sValidator('query', searchRemittancesQuery, invalidRequest), async (c) =>
      respond(c, await service.search(c.get('access').agencyId, c.req.valid('query')))
    )
    .get('/:id', sValidator('param', idParam, invalidRequest), async (c) =>
      respond(c, await service.find(c.get('access').agencyId, c.req.valid('param').id))
    );
