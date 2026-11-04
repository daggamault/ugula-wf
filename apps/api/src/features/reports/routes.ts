import { sValidator } from '@hono/standard-validator';
import { Hono } from 'hono';
import type { AgencyEnv } from '../../shared/access.ts';
import { invalidRequest } from '../../shared/http.ts';
import { respond } from '../../shared/result.ts';
import { reportParam, reportQuery } from './schemas.ts';
import type { ReportService } from './service.ts';

export const createReportRoutes = (service: ReportService) =>
  new Hono<AgencyEnv>().get(
    '/:id',
    sValidator('param', reportParam, invalidRequest),
    sValidator('query', reportQuery, invalidRequest),
    async (c) =>
      respond(
        c,
        await service.run(c.get('access').agencyId, c.req.valid('param').id, c.req.valid('query'))
      )
  );
