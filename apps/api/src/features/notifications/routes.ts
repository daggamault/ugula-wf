import { sValidator } from '@hono/standard-validator';
import { Hono } from 'hono';
import type { AuthEnv } from '../../shared/auth.ts';
import { invalidRequest } from '../../shared/http.ts';
import { respond } from '../../shared/result.ts';
import { notificationSchema } from './schemas.ts';
import type { NotificationService } from './service.ts';

export const createNotificationRoutes = (service: NotificationService) =>
  new Hono<AuthEnv>()
    .get('/', async (c) => {
      const { tenantId, userId } = c.get('session');
      return respond(c, await service.list(tenantId, userId));
    })
    .post('/', sValidator('json', notificationSchema, invalidRequest), async (c) => {
      const { tenantId, userId } = c.get('session');
      return respond(c, await service.create(tenantId, userId, c.req.valid('json')), 201);
    })
    .post('/read', async (c) => {
      const { tenantId, userId } = c.get('session');
      return respond(c, await service.read(tenantId, userId));
    })
    .post('/clear', async (c) => {
      const { tenantId, userId } = c.get('session');
      return respond(c, await service.clear(tenantId, userId));
    });
