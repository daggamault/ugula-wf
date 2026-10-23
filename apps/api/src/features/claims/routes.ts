import { sValidator } from '@hono/standard-validator';
import { Hono } from 'hono';
import * as v from 'valibot';
import type { AuthEnv } from '../../shared/auth.ts';
import { idParam, invalidRequest, uuid } from '../../shared/http.ts';
import { respond } from '../../shared/result.ts';
import { billingDataSchema, listClaimsQuery, payersSchema, responseSchema } from './schemas.ts';
import type { ClaimService } from './service.ts';

const documentParam = v.object({ id: uuid, eventId: uuid });

export const createClaimRoutes = (service: ClaimService) =>
  new Hono<AuthEnv>()
    .get('/', sValidator('query', listClaimsQuery, invalidRequest), async (c) =>
      respond(c, await service.list(c.get('session').tenantId, c.req.valid('query')))
    )
    .get('/:id', sValidator('param', idParam, invalidRequest), async (c) =>
      respond(c, await service.find(c.get('session').tenantId, c.req.valid('param').id))
    )
    .put(
      '/:id/payers',
      sValidator('param', idParam, invalidRequest),
      sValidator('json', payersSchema, invalidRequest),
      async (c) =>
        respond(
          c,
          await service.setPayers(
            c.get('session').tenantId,
            c.req.valid('param').id,
            c.req.valid('json').payers
          )
        )
    )
    .get(
      '/:id/events/:eventId/document',
      sValidator('param', documentParam, invalidRequest),
      async (c) => {
        const { id, eventId } = c.req.valid('param');
        const res = await service.document(c.get('session').tenantId, id, eventId);
        if (!res.ok) return respond(c, res);
        return c.body(Uint8Array.from(res.value.bytes), 200, {
          'content-type': res.value.contentType,
          'content-disposition': `inline; filename="${res.value.name}"`,
          'cache-control': 'private, max-age=300'
        });
      }
    )
    .put(
      '/:id/billing-data',
      sValidator('param', idParam, invalidRequest),
      sValidator('json', billingDataSchema, invalidRequest),
      async (c) =>
        respond(
          c,
          await service.saveBillingData(
            c.get('session').tenantId,
            c.req.valid('param').id,
            c.req.valid('json')
          )
        )
    )
    .post('/:id/restart-cycle', sValidator('param', idParam, invalidRequest), async (c) =>
      respond(
        c,
        await service.restartCycle(c.get('session').tenantId, c.req.valid('param').id),
        201
      )
    )
    .post(
      '/:id/responses',
      sValidator('param', idParam, invalidRequest),
      sValidator('json', responseSchema, invalidRequest),
      async (c) => {
        const { tenantId, userId } = c.get('session');
        return respond(
          c,
          await service.recordResponse(
            tenantId,
            userId,
            c.req.valid('param').id,
            c.req.valid('json')
          ),
          201
        );
      }
    );
