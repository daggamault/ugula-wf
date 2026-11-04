import { sValidator } from '@hono/standard-validator';
import { Hono } from 'hono';
import type { AgencyEnv } from '../../shared/access.ts';
import { idParam, invalidRequest } from '../../shared/http.ts';
import { respond } from '../../shared/result.ts';
import { claimSchema } from './schemas.ts';
import type { SubmissionService } from './service.ts';

export const createSubmissionRoutes = (service: SubmissionService) =>
  new Hono<AgencyEnv>()
    .get('/batches/:id/file', sValidator('param', idParam, invalidRequest), async (c) => {
      const res = await service.document(c.get('access').agencyId, c.req.valid('param').id);
      if (!res.ok) return respond(c, res);
      return c.body(Uint8Array.from(res.value.bytes), 200, {
        'content-type': res.value.contentType,
        'content-disposition': `attachment; filename="${res.value.name}"`,
        'cache-control': 'private, no-store'
      });
    })
    .post('/eligibility', sValidator('json', claimSchema, invalidRequest), async (c) =>
      respond(
        c,
        await service.eligibility(c.get('access').agencyId, c.req.valid('json').claimId),
        201
      )
    );
