import { sValidator } from '@hono/standard-validator';
import { Hono } from 'hono';
import type { AuthEnv } from '../../shared/auth.ts';
import { idParam, invalidRequest } from '../../shared/http.ts';
import { respond } from '../../shared/result.ts';
import { feeSchema } from './schemas.ts';
import type { FeeService } from './service.ts';

export const createFeeRoutes = (service: FeeService) =>
  new Hono<AuthEnv>()
    .get('/', async (c) => respond(c, await service.list(c.get('session').tenantId)))
    .put('/', sValidator('json', feeSchema, invalidRequest), async (c) =>
      respond(c, await service.save(c.get('session').tenantId, c.req.valid('json')))
    )
    .delete('/:id', sValidator('param', idParam, invalidRequest), async (c) =>
      respond(c, await service.remove(c.get('session').tenantId, c.req.valid('param').id))
    );
