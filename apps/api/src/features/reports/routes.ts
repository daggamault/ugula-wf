import { sValidator } from '@hono/standard-validator';
import { Hono } from 'hono';
import type { AuthEnv } from '../../shared/auth.ts';
import { invalidRequest } from '../../shared/http.ts';
import { respond } from '../../shared/result.ts';
import { reportParam, reportQuery } from './schemas.ts';
import type { ReportService } from './service.ts';

export const createReportRoutes = (service: ReportService) =>
  new Hono<AuthEnv>().get(
    '/:id',
    sValidator('param', reportParam, invalidRequest),
    sValidator('query', reportQuery, invalidRequest),
    async (c) =>
      respond(
        c,
        await service.run(c.get('session').tenantId, c.req.valid('param').id, c.req.valid('query'))
      )
  );
