import { sValidator } from '@hono/standard-validator';
import { Hono } from 'hono';
import type { AuthEnv } from '../../shared/auth.ts';
import { idParam, invalidRequest } from '../../shared/http.ts';
import { respond } from '../../shared/result.ts';
import { feeSchema, searchFeesQuery } from './schemas.ts';
import type { FeeService } from './service.ts';

export const createFeeRoutes = (service: FeeService) =>
  new Hono<AuthEnv>()
    .get('/', sValidator('query', searchFeesQuery, invalidRequest), async (c) =>
      respond(c, await service.search(c.get('session').tenantId, c.req.valid('query')))
    )
    .get('/:id', sValidator('param', idParam, invalidRequest), async (c) =>
      respond(c, await service.find(c.get('session').tenantId, c.req.valid('param').id))
    )
    .put('/', sValidator('json', feeSchema, invalidRequest), async (c) =>
      respond(c, await service.save(c.get('session').tenantId, c.req.valid('json')))
    )
    .delete('/:id', sValidator('param', idParam, invalidRequest), async (c) =>
      respond(c, await service.remove(c.get('session').tenantId, c.req.valid('param').id))
    );
