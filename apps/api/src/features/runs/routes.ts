import { sValidator } from '@hono/standard-validator';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { AgencyEnv } from '../../shared/access.ts';
import { FORM_OVERHEAD_BYTES } from '../../shared/files.ts';
import { idParam, invalidRequest } from '../../shared/http.ts';
import { respond } from '../../shared/result.ts';
import { fileFormSchema, listRunsQuery, startRunSchema, stepsQuery } from './schemas.ts';
import type { RunService } from './service.ts';

export const createRunRoutes = (service: RunService, maxBytes: number) =>
  new Hono<AgencyEnv>()
    .post(
      '/files',
      bodyLimit({
        maxSize: maxBytes + FORM_OVERHEAD_BYTES,
        onError: (c) => c.json({ error: 'File too large' }, 413)
      }),
      sValidator('form', fileFormSchema, invalidRequest),
      async (c) => {
        const { file } = c.req.valid('form');
        return respond(
          c,
          await service.uploadFile(c.get('access').agencyId, {
            name: file.name,
            type: file.type,
            bytes: new Uint8Array(await file.arrayBuffer())
          }),
          201
        );
      }
    )
    .get('/', sValidator('query', listRunsQuery, invalidRequest), async (c) => {
      const { q, status, graphId, root, ...page } = c.req.valid('query');
      return respond(
        c,
        await service.list(c.get('access').agencyId, {
          ...(q ? { q } : {}),
          ...(status ? { status } : {}),
          ...(graphId ? { graphId } : {}),
          rootOnly: root === 'true',
          ...page
        })
      );
    })
    .post('/', sValidator('json', startRunSchema, invalidRequest), async (c) => {
      const { graphId, version, inputs } = c.req.valid('json');
      return respond(
        c,
        await service.start(c.get('access').agencyId, graphId, version, inputs),
        201
      );
    })
    .get('/:id', sValidator('param', idParam, invalidRequest), async (c) =>
      respond(c, await service.find(c.get('access').agencyId, c.req.valid('param').id))
    )
    .get('/:id/graphs', sValidator('param', idParam, invalidRequest), async (c) =>
      respond(c, await service.graphs(c.get('access').agencyId, c.req.valid('param').id))
    )
    .get(
      '/:id/steps',
      sValidator('param', idParam, invalidRequest),
      sValidator('query', stepsQuery, invalidRequest),
      async (c) => {
        const { path, node, after, limit } = c.req.valid('query');
        return respond(
          c,
          await service.steps(c.get('access').agencyId, c.req.valid('param').id, {
            ...(path === undefined ? {} : { path }),
            ...(node === undefined ? {} : { node }),
            after,
            limit
          })
        );
      }
    )
    .post('/:id/cancel', sValidator('param', idParam, invalidRequest), async (c) =>
      respond(c, await service.cancel(c.get('access').agencyId, c.req.valid('param').id), 202)
    );
