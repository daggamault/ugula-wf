import { Hono } from 'hono';
import type { AgencyEnv } from '../../shared/access.ts';
import type { AuthEnv } from '../../shared/auth.ts';
import type { AgencyService } from './service.ts';

export const createAgencyListRoutes = (service: AgencyService) =>
  new Hono<AuthEnv>().get('/', async (c) =>
    c.json({ items: await service.list(c.get('session').userId) })
  );

export const createAgencyAccessRoutes = () =>
  new Hono<AgencyEnv>().get('/', (c) => c.json(c.get('access')));
