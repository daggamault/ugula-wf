import { sValidator } from '@hono/standard-validator';
import { Hono } from 'hono';
import type { AgencyEnv } from '../../shared/access.ts';
import { idParam, invalidRequest } from '../../shared/http.ts';
import { respond } from '../../shared/result.ts';
import { facilitySchema, searchFacilitiesQuery } from './schemas.ts';
import type { FacilityService } from './service.ts';

export const createFacilityRoutes = (service: FacilityService) =>
  new Hono<AgencyEnv>()
    .get('/', sValidator('query', searchFacilitiesQuery, invalidRequest), async (c) =>
      respond(c, await service.search(c.get('access').agencyId, c.req.valid('query')))
    )
    .get('/:id', sValidator('param', idParam, invalidRequest), async (c) =>
      respond(c, await service.find(c.get('access').agencyId, c.req.valid('param').id))
    )
    .post('/', sValidator('json', facilitySchema, invalidRequest), async (c) =>
      respond(c, await service.create(c.get('access').agencyId, c.req.valid('json')), 201)
    )
    .put(
      '/:id',
      sValidator('param', idParam, invalidRequest),
      sValidator('json', facilitySchema, invalidRequest),
      async (c) =>
        respond(
          c,
          await service.update(
            c.get('access').agencyId,
            c.req.valid('param').id,
            c.req.valid('json')
          )
        )
    )
    .delete('/:id', sValidator('param', idParam, invalidRequest), async (c) =>
      respond(c, await service.remove(c.get('access').agencyId, c.req.valid('param').id))
    );
