import { sValidator } from '@hono/standard-validator';
import { Hono } from 'hono';
import type { AgencyEnv } from '../../shared/access.ts';
import { invalidRequest } from '../../shared/http.ts';
import { respond } from '../../shared/result.ts';
import { describeKindQuery, searchCodesQuery } from './schemas.ts';
import type { CodeService } from './service.ts';

export const createCodeRoutes = (service: CodeService) =>
  new Hono<AgencyEnv>()
    .get('/', sValidator('query', searchCodesQuery, invalidRequest), async (c) =>
      respond(c, await service.find(c.req.valid('query')))
    )
    .get('/kind', sValidator('query', describeKindQuery, invalidRequest), async (c) =>
      respond(c, await service.describeKind(c.req.valid('query')))
    );
