import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Hono } from 'hono';
import {
  type AgencyAccess,
  type AgencyEnv,
  guardMethods,
  hasPermission,
  requireAgencyAccess,
  requirePermission,
  writesOn
} from './access.ts';
import { testAccess } from './testing.ts';

const AGENCY = '01a16617-7704-7ba6-b9b5-9c79fa44f965';

const forbidden = { error: 'You do not have permission to do this' };

const withAccess = (access: AgencyAccess) =>
  new Hono<AgencyEnv>().use(async (c, next) => {
    c.set('access', access);
    await next();
  });

describe('requireAgencyAccess', () => {
  it('loads access for the session user and the agency in the path', async () => {
    const lookups: string[][] = [];
    const app = new Hono<AgencyEnv>()
      .use(async (c, next) => {
        c.set('session', { userId: 'u-1', email: 'dev@example.com' });
        await next();
      })
      .use(
        '/agencies/:agencyId/*',
        requireAgencyAccess(async (userId, agencyId) => {
          lookups.push([userId, agencyId]);
          return agencyId === AGENCY ? testAccess() : null;
        })
      )
      .get('/agencies/:agencyId/me', (c) => c.json(c.get('access').agencyName));
    const res = await app.request(`/agencies/${AGENCY}/me`);
    assert.equal(res.status, 200);
    assert.equal(await res.json(), 'Development');
    const other = await app.request('/agencies/01a16617-7704-7ba6-b9b5-9c79fa44f966/me');
    assert.equal(other.status, 404);
    assert.deepEqual(await other.json(), { error: 'Agency not found' });
    assert.equal((await app.request('/agencies/nope/me')).status, 404);
    assert.deepEqual(lookups, [
      ['u-1', AGENCY],
      ['u-1', '01a16617-7704-7ba6-b9b5-9c79fa44f966']
    ]);
  });
});

describe('hasPermission and requirePermission', () => {
  it('lets through only holders of the permission', async () => {
    assert.equal(hasPermission(testAccess(['fees:read']), 'fees:read'), true);
    assert.equal(hasPermission(testAccess(['fees:read']), 'fees:update'), false);
    const app = (access: AgencyAccess) =>
      withAccess(access).get('/', requirePermission('fees:read'), (c) => c.text('ok'));
    assert.equal((await app(testAccess(['fees:read'])).request('/')).status, 200);
    const denied = await app(testAccess([])).request('/');
    assert.equal(denied.status, 403);
    assert.deepEqual(await denied.json(), forbidden);
  });
});

describe('guardMethods', () => {
  const app = (access: AgencyAccess) =>
    withAccess(access)
      .use(guardMethods({ GET: null, POST: 'fees:create' }))
      .all('/', (c) => c.text('ok'));

  it('maps each method to a permission, letting null through and HEAD follow GET', async () => {
    const none = app(testAccess([]));
    assert.equal((await none.request('/')).status, 200);
    assert.equal((await none.request('/', { method: 'HEAD' })).status, 200);
    assert.equal((await none.request('/', { method: 'POST' })).status, 403);
    assert.equal(
      (await app(testAccess(['fees:create'])).request('/', { method: 'POST' })).status,
      200
    );
  });

  it('forbids methods it does not list', async () => {
    const res = await app(testAccess()).request('/', { method: 'DELETE' });
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), forbidden);
  });

  it('lets through holders of any permission in a list', async () => {
    const put = (access: AgencyAccess) =>
      withAccess(access)
        .use(guardMethods({ PUT: ['fees:create', 'fees:update'] }))
        .put('/', (c) => c.text('ok'))
        .request('/', { method: 'PUT' });
    assert.equal((await put(testAccess(['fees:create']))).status, 200);
    assert.equal((await put(testAccess(['fees:update']))).status, 200);
    assert.equal((await put(testAccess(['fees:read']))).status, 403);
  });
});

describe('writesOn', () => {
  it('says whether the caller may add and may change rows of a resource', () => {
    assert.deepEqual(writesOn(testAccess(['fees:create']), 'fees'), {
      create: true,
      update: false
    });
    assert.deepEqual(writesOn(testAccess(['payers:update']), 'payers'), {
      create: false,
      update: true
    });
  });
});
