import { sValidator } from '@hono/standard-validator';
import { Hono } from 'hono';
import type { AuthEnv } from '../../shared/auth.ts';
import { idParam, invalidRequest } from '../../shared/http.ts';
import { respond } from '../../shared/result.ts';
import { listRunsQuery, signalSchema, startRunSchema, stepsQuery } from './schemas.ts';
import type { RunService } from './service.ts';

export const createRunRoutes = (service: RunService) =>
  new Hono<AuthEnv>()
    .get('/', sValidator('query', listRunsQuery, invalidRequest), async (c) => {
      const { status, graphId, root, ...page } = c.req.valid('query');
      return respond(
        c,
        await service.list(c.get('session').tenantId, {
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
        await service.start(c.get('session').tenantId, graphId, version, inputs),
        201
      );
    })
    .post('/signals', sValidator('json', signalSchema, invalidRequest), async (c) => {
      const { name, key, payload } = c.req.valid('json');
      return respond(c, await service.signal(c.get('session').tenantId, name, key, payload));
    })
    .get('/:id', sValidator('param', idParam, invalidRequest), async (c) =>
      respond(c, await service.find(c.get('session').tenantId, c.req.valid('param').id))
    )
    .get('/:id/graphs', sValidator('param', idParam, invalidRequest), async (c) =>
      respond(c, await service.graphs(c.get('session').tenantId, c.req.valid('param').id))
    )
    .get(
      '/:id/steps',
      sValidator('param', idParam, invalidRequest),
      sValidator('query', stepsQuery, invalidRequest),
      async (c) => {
        const { path, node, after, limit } = c.req.valid('query');
        return respond(
          c,
          await service.steps(c.get('session').tenantId, c.req.valid('param').id, {
            ...(path === undefined ? {} : { path }),
            ...(node === undefined ? {} : { node }),
            after,
            limit
          })
        );
      }
    )
    .post('/:id/cancel', sValidator('param', idParam, invalidRequest), async (c) =>
      respond(c, await service.cancel(c.get('session').tenantId, c.req.valid('param').id), 202)
    );
