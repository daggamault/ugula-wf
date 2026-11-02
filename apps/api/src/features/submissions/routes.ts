import { sValidator } from '@hono/standard-validator';
import { Hono } from 'hono';
import type { AuthEnv } from '../../shared/auth.ts';
import { idParam, invalidRequest } from '../../shared/http.ts';
import { respond } from '../../shared/result.ts';
import { batchSchema, manualSubmissionSchema, pendingQuery } from './schemas.ts';
import type { SubmissionService } from './service.ts';

export const createSubmissionRoutes = (service: SubmissionService) =>
  new Hono<AuthEnv>()
    .get('/pending', sValidator('query', pendingQuery, invalidRequest), async (c) =>
      respond(c, await service.pending(c.get('session').tenantId, c.req.valid('query').claimId))
    )
    .post('/batches', sValidator('json', batchSchema, invalidRequest), async (c) => {
      const { tenantId, userId } = c.get('session');
      return respond(c, await service.create(tenantId, userId, c.req.valid('json').claimId), 201);
    })
    .get('/batches/:id/file', sValidator('param', idParam, invalidRequest), async (c) => {
      const res = await service.document(c.get('session').tenantId, c.req.valid('param').id);
      if (!res.ok) return respond(c, res);
      return c.body(Uint8Array.from(res.value.bytes), 200, {
        'content-type': res.value.contentType,
        'content-disposition': `attachment; filename="${res.value.name}"`,
        'cache-control': 'private, no-store'
      });
    })
    .post('/manual', sValidator('json', manualSubmissionSchema, invalidRequest), async (c) => {
      const { tenantId, userId } = c.get('session');
      const { claimId, note } = c.req.valid('json');
      return respond(c, await service.markSubmitted(tenantId, userId, claimId, note), 201);
    });
