import { sValidator } from '@hono/standard-validator';
import { Hono } from 'hono';
import type { AgencyEnv } from '../../shared/access.ts';
import { idParam, invalidRequest } from '../../shared/http.ts';
import { respond } from '../../shared/result.ts';
import { depositSchema, searchDepositsQuery } from './schemas.ts';
import type { DepositService } from './service.ts';

export const createDepositRoutes = (service: DepositService) =>
  new Hono<AgencyEnv>()
    .get('/', sValidator('query', searchDepositsQuery, invalidRequest), async (c) =>
      respond(c, await service.search(c.get('access').agencyId, c.req.valid('query')))
    )
    .get('/:id', sValidator('param', idParam, invalidRequest), async (c) =>
      respond(c, await service.find(c.get('access').agencyId, c.req.valid('param').id))
    )
    .post('/', sValidator('json', depositSchema, invalidRequest), async (c) =>
      respond(
        c,
        await service.record(c.get('access').agencyId, c.get('access').userId, c.req.valid('json')),
        201
      )
    );
