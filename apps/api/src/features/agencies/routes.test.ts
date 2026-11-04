import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Hono } from 'hono';
import { requireAuth } from '../../shared/auth.ts';
import { testAccess, testSessions, withSession } from '../../shared/testing.ts';
import { createAgencyAccessRoutes, createAgencyListRoutes } from './routes.ts';
import type { AgencyService } from './service.ts';

const agencies = [
  { id: 't-1', name: 'Development', organizationId: 'o-1', organizationName: 'Development EMS' }
];

describe('agency routes', () => {
  it('lists the session user’s agencies', async () => {
    const users: string[] = [];
    const service = {
      list: async (userId: string) => {
        users.push(userId);
        return agencies;
      }
    } as unknown as AgencyService;
    const app = new Hono()
      .use(requireAuth(async (token) => (token ? testSessions.get(token) : null)))
      .route('/', createAgencyListRoutes(service));
    const res = await app.request('/', { headers: { cookie: 'ugula_session=test' } });
    assert.deepEqual(await res.json(), { items: agencies });
    assert.deepEqual(users, ['u-1']);
    assert.equal((await app.request('/')).status, 401);
  });

  it('returns the caller’s access to the agency', async () => {
    const access = testAccess(['fees:read']);
    const res = await withSession(createAgencyAccessRoutes(), access)('/');
    assert.deepEqual(await res.json(), access);
  });
});
