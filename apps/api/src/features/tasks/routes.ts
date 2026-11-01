import { sValidator } from '@hono/standard-validator';
import { Hono } from 'hono';
import type { AuthEnv } from '../../shared/auth.ts';
import { idParam, invalidRequest } from '../../shared/http.ts';
import { respond } from '../../shared/result.ts';
import { completeTaskSchema, listTasksQuery, nextTaskSchema } from './schemas.ts';
import type { TaskService } from './service.ts';

export const createTaskRoutes = (service: TaskService) =>
  new Hono<AuthEnv>()
    .get('/queues', async (c) => {
      const { tenantId, userId } = c.get('session');
      return respond(c, await service.queues(tenantId, userId));
    })
    .get('/', sValidator('query', listTasksQuery, invalidRequest), async (c) => {
      const { tenantId, userId } = c.get('session');
      const { queue, status, assignee, ...page } = c.req.valid('query');
      return respond(
        c,
        await service.list(tenantId, {
          ...(queue ? { queue } : {}),
          ...(assignee === 'anyone' ? {} : { assignee: { id: assignee === 'me' ? userId : null } }),
          status,
          ...page
        })
      );
    })
    .post('/next', sValidator('json', nextTaskSchema, invalidRequest), async (c) => {
      const { tenantId, userId } = c.get('session');
      return respond(c, await service.next(tenantId, c.req.valid('json').queue, userId));
    })
    .get('/:id', sValidator('param', idParam, invalidRequest), async (c) =>
      respond(c, await service.find(c.get('session').tenantId, c.req.valid('param').id))
    )
    .post('/:id/claim', sValidator('param', idParam, invalidRequest), async (c) => {
      const { tenantId, userId } = c.get('session');
      return respond(c, await service.claim(tenantId, c.req.valid('param').id, userId));
    })
    .post('/:id/release', sValidator('param', idParam, invalidRequest), async (c) =>
      respond(c, await service.release(c.get('session').tenantId, c.req.valid('param').id))
    )
    .post(
      '/:id/complete',
      sValidator('param', idParam, invalidRequest),
      sValidator('json', completeTaskSchema, invalidRequest),
      async (c) => {
        const { tenantId, userId } = c.get('session');
        const { id } = c.req.valid('param');
        return respond(c, await service.complete(tenantId, userId, id, c.req.valid('json')));
      }
    );
