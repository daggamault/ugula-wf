import { sValidator } from '@hono/standard-validator';
import { Hono } from 'hono';
import type { AuthEnv } from '../../shared/auth.ts';
import { idParam, invalidRequest } from '../../shared/http.ts';
import { respond } from '../../shared/result.ts';
import { aliasParams, payerSchema } from './schemas.ts';
import type { PayerService } from './service.ts';

export const createPayerRoutes = (service: PayerService) =>
  new Hono<AuthEnv>()
    .get('/', async (c) => respond(c, await service.list(c.get('session').tenantId)))
    .put('/', sValidator('json', payerSchema, invalidRequest), async (c) =>
      respond(c, await service.save(c.get('session').tenantId, c.req.valid('json')))
    )
    .delete('/:id', sValidator('param', idParam, invalidRequest), async (c) =>
      respond(c, await service.remove(c.get('session').tenantId, c.req.valid('param').id))
    )
    .delete(
      '/:id/aliases/:aliasId',
      sValidator('param', aliasParams, invalidRequest),
      async (c) => {
        const { id, aliasId } = c.req.valid('param');
        return respond(c, await service.forget(c.get('session').tenantId, id, aliasId));
      }
    );
