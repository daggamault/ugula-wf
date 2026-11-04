import { sValidator } from '@hono/standard-validator';
import { Hono } from 'hono';
import type { AgencyEnv } from '../../shared/access.ts';
import { idParam, invalidRequest } from '../../shared/http.ts';
import { respond } from '../../shared/result.ts';
import { listPatientsQuery } from './schemas.ts';
import type { PatientService } from './service.ts';

export const createPatientRoutes = (service: PatientService) =>
  new Hono<AgencyEnv>()
    .get('/', sValidator('query', listPatientsQuery, invalidRequest), async (c) =>
      respond(c, await service.list(c.get('access').agencyId, c.req.valid('query')))
    )
    .get('/:id', sValidator('param', idParam, invalidRequest), async (c) =>
      respond(c, await service.find(c.get('access').agencyId, c.req.valid('param').id))
    );
