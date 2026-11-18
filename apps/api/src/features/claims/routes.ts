import { sValidator } from '@hono/standard-validator';
import { Hono } from 'hono';
import type { AgencyEnv } from '../../shared/access.ts';
import { idParam, invalidRequest } from '../../shared/http.ts';
import { respond } from '../../shared/result.ts';
import { editClaimSchema, searchClaimsQuery } from './schemas.ts';
import type { ClaimService } from './service.ts';

export const createClaimRoutes = (service: ClaimService) =>
  new Hono<AgencyEnv>()
    .get('/', sValidator('query', searchClaimsQuery, invalidRequest), async (c) =>
      respond(c, await service.search(c.get('access').agencyId, c.req.valid('query')))
    )
    .get('/:id', sValidator('param', idParam, invalidRequest), async (c) =>
      respond(c, await service.find(c.get('access').agencyId, c.req.valid('param').id))
    )
    .put(
      '/:id',
      sValidator('param', idParam, invalidRequest),
      sValidator('json', editClaimSchema, invalidRequest),
      async (c) =>
        respond(
          c,
          await service.edit(
            c.get('access').agencyId,
            c.get('session').userId,
            c.req.valid('param').id,
            c.req.valid('json')
          )
        )
    );
