import { sValidator } from '@hono/standard-validator';
import { Hono } from 'hono';
import type { AgencyEnv } from '../../shared/access.ts';
import { invalidRequest } from '../../shared/http.ts';
import { respond } from '../../shared/result.ts';
import { billingProfileSchema } from './schemas.ts';
import type { BillingProfileService } from './service.ts';

export const createBillingProfileRoutes = (service: BillingProfileService) =>
  new Hono<AgencyEnv>()
    .get('/', async (c) => respond(c, await service.find(c.get('access').agencyId)))
    .put('/', sValidator('json', billingProfileSchema, invalidRequest), async (c) =>
      respond(c, await service.save(c.get('access').agencyId, c.req.valid('json')))
    );
