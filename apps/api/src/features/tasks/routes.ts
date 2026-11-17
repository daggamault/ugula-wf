import { sValidator } from '@hono/standard-validator';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { AgencyEnv } from '../../shared/access.ts';
import { FORM_OVERHEAD_BYTES } from '../../shared/files.ts';
import { idParam, invalidRequest } from '../../shared/http.ts';
import { respond } from '../../shared/result.ts';
import { completeTaskSchema, nextTaskSchema, searchTasksQuery, taskFileSchema } from './schemas.ts';
import type { TaskService } from './service.ts';

export const createTaskRoutes = (service: TaskService) =>
  new Hono<AgencyEnv>()
    .get('/', sValidator('query', searchTasksQuery, invalidRequest), async (c) => {
      const { q, ...filters } = c.req.valid('query');
      return respond(
        c,
        await service.search(c.get('access').agencyId, { ...filters, ...(q ? { q } : {}) })
      );
    })
    .get('/queues', async (c) => {
      const { agencyId, userId } = c.get('access');
      return respond(c, await service.queues(agencyId, userId));
    })
    .post('/next', sValidator('json', nextTaskSchema, invalidRequest), async (c) => {
      const { agencyId, userId, permissions } = c.get('access');
      return respond(
        c,
        await service.next(agencyId, c.req.valid('json').queue, userId, permissions)
      );
    })
    .get('/:id', sValidator('param', idParam, invalidRequest), async (c) =>
      respond(c, await service.find(c.get('access').agencyId, c.req.valid('param').id))
    )
    .post('/:id/claim', sValidator('param', idParam, invalidRequest), async (c) => {
      const { agencyId, userId, permissions } = c.get('access');
      return respond(
        c,
        await service.claim(agencyId, c.req.valid('param').id, userId, permissions)
      );
    })
    .post('/:id/release', sValidator('param', idParam, invalidRequest), async (c) => {
      const { agencyId, userId } = c.get('access');
      return respond(c, await service.release(agencyId, c.req.valid('param').id, userId));
    })
    .post(
      '/:id/files',
      bodyLimit({
        maxSize: service.maxBytes + FORM_OVERHEAD_BYTES,
        onError: (c) => c.json({ error: 'File too large' }, 413)
      }),
      sValidator('param', idParam, invalidRequest),
      sValidator('form', taskFileSchema, invalidRequest),
      async (c) => {
        const { agencyId, userId } = c.get('access');
        const { file } = c.req.valid('form');
        return respond(
          c,
          await service.uploadFile(agencyId, c.req.valid('param').id, userId, {
            name: file.name,
            type: file.type,
            bytes: new Uint8Array(await file.arrayBuffer())
          }),
          201
        );
      }
    )
    .post(
      '/:id/complete',
      sValidator('param', idParam, invalidRequest),
      sValidator('json', completeTaskSchema, invalidRequest),
      async (c) => {
        const { agencyId, userId, permissions } = c.get('access');
        const { id } = c.req.valid('param');
        return respond(
          c,
          await service.complete(agencyId, userId, id, c.req.valid('json'), permissions)
        );
      }
    );
