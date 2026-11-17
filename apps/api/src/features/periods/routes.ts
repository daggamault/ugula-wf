import { sValidator } from '@hono/standard-validator';
import { Hono } from 'hono';
import type { AgencyEnv } from '../../shared/access.ts';
import { invalidRequest } from '../../shared/http.ts';
import { respond } from '../../shared/result.ts';
import { searchPeriodsQuery } from './schemas.ts';
import type { PeriodService } from './service.ts';

export const createPeriodRoutes = (service: PeriodService) =>
  new Hono<AgencyEnv>().get(
    '/',
    sValidator('query', searchPeriodsQuery, invalidRequest),
    async (c) => respond(c, await service.search(c.get('access').agencyId, c.req.valid('query')))
  );
