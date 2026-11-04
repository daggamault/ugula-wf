import { sValidator } from '@hono/standard-validator';
import { Hono } from 'hono';
import type { AgencyEnv } from '../../shared/access.ts';
import { invalidRequest } from '../../shared/http.ts';
import { respond } from '../../shared/result.ts';
import { connectionSchema } from './schemas.ts';
import type { ConnectionService } from './service.ts';

export const createConnectionRoutes = (service: ConnectionService) =>
  new Hono<AgencyEnv>()
    .get('/', async (c) => respond(c, await service.find(c.get('access').agencyId)))
    .put('/', sValidator('json', connectionSchema, invalidRequest), async (c) =>
      respond(c, await service.save(c.get('access').agencyId, c.req.valid('json')))
    )
    .delete('/', async (c) => respond(c, await service.remove(c.get('access').agencyId)));
