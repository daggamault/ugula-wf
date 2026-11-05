import { sValidator } from '@hono/standard-validator';
import { Hono } from 'hono';
import * as v from 'valibot';
import type { AgencyEnv } from '../../shared/access.ts';
import { idParam, invalidRequest, uuid } from '../../shared/http.ts';
import { respond } from '../../shared/result.ts';
import {
  documentParam as claimDocumentParam,
  claimEventsQuery,
  listClaimsQuery,
  startTaskSchema
} from './schemas.ts';
import type { ClaimService } from './service.ts';

const documentParam = v.object({ id: uuid, eventId: uuid });

export const createClaimRoutes = (service: ClaimService) =>
  new Hono<AgencyEnv>()
    .get('/', sValidator('query', listClaimsQuery, invalidRequest), async (c) =>
      respond(c, await service.list(c.get('access').agencyId, c.req.valid('query')))
    )
    .get('/:id', sValidator('param', idParam, invalidRequest), async (c) =>
      respond(c, await service.find(c.get('access').agencyId, c.req.valid('param').id))
    )
    .get(
      '/:id/events',
      sValidator('param', idParam, invalidRequest),
      sValidator('query', claimEventsQuery, invalidRequest),
      async (c) =>
        respond(
          c,
          await service.events(
            c.get('access').agencyId,
            c.req.valid('param').id,
            c.req.valid('query')
          )
        )
    )
    .get(
      '/:id/events/:eventId/document',
      sValidator('param', documentParam, invalidRequest),
      async (c) => {
        const { id, eventId } = c.req.valid('param');
        const res = await service.document(c.get('access').agencyId, id, eventId);
        if (!res.ok) return respond(c, res);
        return c.body(Uint8Array.from(res.value.bytes), 200, {
          'content-type': res.value.contentType,
          'content-disposition': `inline; filename="${res.value.name}"`,
          'cache-control': 'private, max-age=300'
        });
      }
    )
    .get(
      '/:id/documents/:documentId',
      sValidator('param', claimDocumentParam, invalidRequest),
      async (c) => {
        const { id, documentId } = c.req.valid('param');
        const res = await service.documentFile(c.get('access').agencyId, id, documentId);
        if (!res.ok) return respond(c, res);
        return c.body(Uint8Array.from(res.value.bytes), 200, {
          'content-type': res.value.contentType,
          'content-disposition': `inline; filename="${res.value.name.replace(/[^\w.-]/g, '_')}"`,
          'cache-control': 'private, max-age=300'
        });
      }
    )
    .post('/:id/restart-cycle', sValidator('param', idParam, invalidRequest), async (c) =>
      respond(c, await service.restartCycle(c.get('access').agencyId, c.req.valid('param').id), 201)
    )
    .post(
      '/:id/tasks',
      sValidator('param', idParam, invalidRequest),
      sValidator('json', startTaskSchema, invalidRequest),
      async (c) => {
        const { agencyId, userId } = c.get('access');
        return respond(
          c,
          await service.startTask(
            agencyId,
            userId,
            c.req.valid('param').id,
            c.req.valid('json').workflow
          ),
          201
        );
      }
    );
