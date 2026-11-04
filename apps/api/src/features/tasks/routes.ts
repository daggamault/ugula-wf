import { sValidator } from '@hono/standard-validator';
import { Hono } from 'hono';
import type { AgencyEnv } from '../../shared/access.ts';
import { idParam, invalidRequest } from '../../shared/http.ts';
import { respond } from '../../shared/result.ts';
import { completeTaskSchema, nextTaskSchema } from './schemas.ts';
import type { TaskService } from './service.ts';

export const createTaskRoutes = (service: TaskService) =>
  new Hono<AgencyEnv>()
    .get('/queues', async (c) => {
      const { agencyId, userId } = c.get('access');
      return respond(c, await service.queues(agencyId, userId));
    })
    .post('/next', sValidator('json', nextTaskSchema, invalidRequest), async (c) => {
      const { agencyId, userId } = c.get('access');
      return respond(c, await service.next(agencyId, c.req.valid('json').queue, userId));
    })
    .get('/:id', sValidator('param', idParam, invalidRequest), async (c) =>
      respond(c, await service.find(c.get('access').agencyId, c.req.valid('param').id))
    )
    .post('/:id/claim', sValidator('param', idParam, invalidRequest), async (c) => {
      const { agencyId, userId } = c.get('access');
      return respond(c, await service.claim(agencyId, c.req.valid('param').id, userId));
    })
    .post('/:id/release', sValidator('param', idParam, invalidRequest), async (c) => {
      const { agencyId, userId } = c.get('access');
      return respond(c, await service.release(agencyId, c.req.valid('param').id, userId));
    })
    .post(
      '/:id/complete',
      sValidator('param', idParam, invalidRequest),
      sValidator('json', completeTaskSchema, invalidRequest),
      async (c) => {
        const { agencyId, userId } = c.get('access');
        const { id } = c.req.valid('param');
        return respond(c, await service.complete(agencyId, userId, id, c.req.valid('json')));
      }
    );
