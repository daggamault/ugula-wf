import { sValidator } from '@hono/standard-validator';
import { documentContentTypeOf } from '@ugula/billing';
import { type Context, Hono } from 'hono';
import * as v from 'valibot';
import type { AgencyEnv } from '../../shared/access.ts';
import { idParam, invalidRequest, uuid } from '../../shared/http.ts';
import { respond } from '../../shared/result.ts';
import {
  documentParam as claimDocumentParam,
  listClaimEventsQuery,
  searchClaimsQuery,
  startTaskSchema
} from './schemas.ts';
import type { ClaimService } from './service.ts';

const documentParam = v.object({ id: uuid, eventId: uuid });

const serveFile = (c: Context<AgencyEnv>, file: { bytes: Uint8Array; name: string }) => {
  const viewable = documentContentTypeOf(file.bytes);
  return c.body(Uint8Array.from(file.bytes), 200, {
    'content-type': viewable ?? 'application/octet-stream',
    'content-disposition': `${viewable ? 'inline' : 'attachment'}; filename="${file.name.replace(/[^\w.-]/g, '_')}"`,
    'x-content-type-options': 'nosniff',
    'cache-control': 'private, max-age=300'
  });
};

export const createClaimRoutes = (service: ClaimService) =>
  new Hono<AgencyEnv>()
    .get('/', sValidator('query', searchClaimsQuery, invalidRequest), async (c) =>
      respond(c, await service.search(c.get('access').agencyId, c.req.valid('query')))
    )
    .get('/:id', sValidator('param', idParam, invalidRequest), async (c) =>
      respond(c, await service.find(c.get('access').agencyId, c.req.valid('param').id))
    )
    .get(
      '/:id/events',
      sValidator('param', idParam, invalidRequest),
      sValidator('query', listClaimEventsQuery, invalidRequest),
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
        return res.ok ? serveFile(c, res.value) : respond(c, res);
      }
    )
    .get(
      '/:id/documents/:documentId',
      sValidator('param', claimDocumentParam, invalidRequest),
      async (c) => {
        const { id, documentId } = c.req.valid('param');
        const res = await service.documentFile(c.get('access').agencyId, id, documentId);
        return res.ok ? serveFile(c, res.value) : respond(c, res);
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
