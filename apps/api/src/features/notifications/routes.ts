import { sValidator } from '@hono/standard-validator';
import { Hono } from 'hono';
import type { AgencyEnv } from '../../shared/access.ts';
import { invalidRequest } from '../../shared/http.ts';
import { respond } from '../../shared/result.ts';
import { notificationSchema } from './schemas.ts';
import type { NotificationService } from './service.ts';

export const createNotificationRoutes = (service: NotificationService) =>
  new Hono<AgencyEnv>()
    .get('/', async (c) => {
      const { agencyId, userId } = c.get('access');
      return respond(c, await service.list(agencyId, userId));
    })
    .post('/', sValidator('json', notificationSchema, invalidRequest), async (c) => {
      const { agencyId, userId } = c.get('access');
      return respond(c, await service.create(agencyId, userId, c.req.valid('json')), 201);
    })
    .post('/read', async (c) => {
      const { agencyId, userId } = c.get('access');
      return respond(c, await service.read(agencyId, userId));
    })
    .post('/clear', async (c) => {
      const { agencyId, userId } = c.get('access');
      return respond(c, await service.clear(agencyId, userId));
    });
