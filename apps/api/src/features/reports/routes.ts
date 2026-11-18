import { sValidator } from '@hono/standard-validator';
import { Hono } from 'hono';
import type { AgencyEnv } from '../../shared/access.ts';
import { invalidRequest } from '../../shared/http.ts';
import { respond } from '../../shared/result.ts';
import { remittanceReportQuery } from './schemas.ts';
import type { ReportService } from './service.ts';

export const createReportRoutes = (service: ReportService) =>
  new Hono<AgencyEnv>().get(
    '/remittances',
    sValidator('query', remittanceReportQuery, invalidRequest),
    async (c) =>
      respond(c, await service.remittances(c.get('access').agencyId, c.req.valid('query')))
  );
