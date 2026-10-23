import { sValidator } from '@hono/standard-validator';
import { Hono } from 'hono';
import type { AuthEnv } from '../../shared/auth.ts';
import { invalidRequest } from '../../shared/http.ts';
import { respond } from '../../shared/result.ts';
import { billingProfileSchema } from './schemas.ts';
import type { BillingProfileService } from './service.ts';

export const createBillingProfileRoutes = (service: BillingProfileService) =>
  new Hono<AuthEnv>()
    .get('/', async (c) => respond(c, await service.find(c.get('session').tenantId)))
    .put('/', sValidator('json', billingProfileSchema, invalidRequest), async (c) =>
      respond(c, await service.save(c.get('session').tenantId, c.req.valid('json')))
    );
