import { sValidator } from '@hono/standard-validator';
import { Hono } from 'hono';
import type { AuthEnv } from '../../shared/auth.ts';
import { invalidRequest } from '../../shared/http.ts';
import { respond } from '../../shared/result.ts';
import { rangeQuery } from './schemas.ts';
import type { ReportService } from './service.ts';

export const createReportRoutes = (service: ReportService) =>
  new Hono<AuthEnv>()
    .get('/aging', async (c) => respond(c, await service.aging(c.get('session').tenantId)))
    .get('/monthly', sValidator('query', rangeQuery, invalidRequest), async (c) =>
      respond(c, await service.monthly(c.get('session').tenantId, c.req.valid('query')))
    )
    .get('/hcpcs', sValidator('query', rangeQuery, invalidRequest), async (c) =>
      respond(c, await service.hcpcs(c.get('session').tenantId, c.req.valid('query')))
    )
    .get('/payers', sValidator('query', rangeQuery, invalidRequest), async (c) =>
      respond(c, await service.payers(c.get('session').tenantId, c.req.valid('query')))
    );
