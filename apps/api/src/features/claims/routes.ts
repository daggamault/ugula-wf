import { sValidator } from '@hono/standard-validator';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import * as v from 'valibot';
import type { AgencyEnv } from '../../shared/access.ts';
import { FORM_OVERHEAD_BYTES } from '../../shared/files.ts';
import { idParam, invalidRequest, uuid } from '../../shared/http.ts';
import { respond } from '../../shared/result.ts';
import {
  billingDataSchema,
  chaseSchema,
  documentParam as claimDocumentParam,
  claimEventsQuery,
  documentFormSchema,
  facilityOptionsQuery,
  facilitySchema,
  listClaimsQuery,
  payersSchema,
  recordsRequestSchema,
  responseSchema
} from './schemas.ts';
import type { ClaimService } from './service.ts';

const documentParam = v.object({ id: uuid, eventId: uuid });

const fileOf = async (file: File) => ({
  name: file.name,
  type: file.type,
  bytes: new Uint8Array(await file.arrayBuffer())
});

export const createClaimRoutes = (service: ClaimService, maxBytes: number) =>
  new Hono<AgencyEnv>()
    .get('/', sValidator('query', listClaimsQuery, invalidRequest), async (c) =>
      respond(c, await service.list(c.get('access').agencyId, c.req.valid('query')))
    )
    .get(
      '/facility-options',
      sValidator('query', facilityOptionsQuery, invalidRequest),
      async (c) =>
        respond(c, await service.facilityOptions(c.get('access').agencyId, c.req.valid('query').q))
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
    .put(
      '/:id/payers',
      sValidator('param', idParam, invalidRequest),
      sValidator('json', payersSchema, invalidRequest),
      async (c) =>
        respond(
          c,
          await service.setPayers(
            c.get('access').agencyId,
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
        const res = await service.document(c.get('access').agencyId, id, eventId);
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
      async (c) => {
        const { agencyId, userId } = c.get('access');
        return respond(
          c,
          await service.saveBillingData(
            agencyId,
            userId,
            c.req.valid('param').id,
            c.req.valid('json')
          )
        );
      }
    )
    .put(
      '/:id/facility',
      sValidator('param', idParam, invalidRequest),
      sValidator('json', facilitySchema, invalidRequest),
      async (c) =>
        respond(
          c,
          await service.setFacility(
            c.get('access').agencyId,
            c.get('access').userId,
            c.req.valid('param').id,
            c.req.valid('json').facilityId
          )
        )
    )
    .post(
      '/:id/records-request',
      sValidator('param', idParam, invalidRequest),
      sValidator('json', recordsRequestSchema, invalidRequest),
      async (c) =>
        respond(
          c,
          await service.requestRecords(
            c.get('access').agencyId,
            c.req.valid('param').id,
            c.req.valid('json')
          ),
          201
        )
    )
    .post(
      '/:id/documents',
      bodyLimit({
        maxSize: maxBytes + FORM_OVERHEAD_BYTES,
        onError: (c) => c.json({ error: 'File too large' }, 413)
      }),
      sValidator('param', idParam, invalidRequest),
      sValidator('form', documentFormSchema, invalidRequest),
      async (c) => {
        const { agencyId, userId } = c.get('access');
        const { file, kind, signedOn } = c.req.valid('form');
        return respond(
          c,
          await service.uploadDocument(agencyId, userId, c.req.valid('param').id, {
            kind,
            signedOn,
            file: await fileOf(file)
          }),
          201
        );
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
    .post(
      '/:id/document-chases',
      sValidator('param', idParam, invalidRequest),
      sValidator('json', chaseSchema, invalidRequest),
      async (c) =>
        respond(
          c,
          await service.chaseDocument(
            c.get('access').agencyId,
            c.req.valid('param').id,
            c.req.valid('json')
          ),
          201
        )
    )
    .post('/:id/restart-cycle', sValidator('param', idParam, invalidRequest), async (c) =>
      respond(c, await service.restartCycle(c.get('access').agencyId, c.req.valid('param').id), 201)
    )
    .post(
      '/:id/responses',
      sValidator('param', idParam, invalidRequest),
      sValidator('json', responseSchema, invalidRequest),
      async (c) => {
        const { agencyId, userId } = c.get('access');
        return respond(
          c,
          await service.recordResponse(
            agencyId,
            userId,
            c.req.valid('param').id,
            c.req.valid('json')
          ),
          201
        );
      }
    );
