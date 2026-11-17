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

const OTHER = '01a16617-7704-7ba6-b9b5-9c79fa44f966';

const forbidden = { error: 'You do not have permission to do this' };

const withAccess = (access: AgencyAccess) =>
  new Hono<AgencyEnv>().use(async (c, next) => {
    c.set('access', access);
    await next();
  });

const agencyApp = () => {
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
    .get('/agencies/:agencyId/me', (c) => c.json(c.get('access')));
  return { app, lookups };
};

const respond = async (res: Response) => [res.status, await res.json()];

describe('requireAgencyAccess', () => {
  it('loads access for the session user and the agency in the path', async () => {
    const { app, lookups } = agencyApp();
    assert.deepEqual(await respond(await app.request(`/agencies/${AGENCY}/me`)), [
      200,
      testAccess()
    ]);
    assert.deepEqual(lookups, [['u-1', AGENCY]]);
  });

  it('hides agencies the user does not belong to', async () => {
    const { app, lookups } = agencyApp();
    assert.deepEqual(await respond(await app.request(`/agencies/${OTHER}/me`)), [
      404,
      { error: 'Agency not found' }
    ]);
    assert.deepEqual(lookups, [['u-1', OTHER]]);
  });

  it('answers a malformed agency id as not found without looking it up', async () => {
    const { app, lookups } = agencyApp();
    assert.deepEqual(await respond(await app.request('/agencies/nope/me')), [
      404,
      { error: 'Agency not found' }
    ]);
    assert.deepEqual(lookups, []);
  });
});

describe('hasPermission', () => {
  it('says whether the access holds a permission', () => {
    assert.equal(hasPermission(testAccess(['fees:read']), 'fees:read'), true);
    assert.equal(hasPermission(testAccess(['fees:read']), 'fees:update'), false);
  });
});

describe('requirePermission', () => {
  const app = (access: AgencyAccess) =>
    withAccess(access).get('/', requirePermission('fees:read'), (c) => c.text('ok'));

  it('lets holders of the permission through', async () => {
    const res = await app(testAccess(['fees:read'])).request('/');
    assert.deepEqual([res.status, await res.text()], [200, 'ok']);
  });

  it('forbids everyone else', async () => {
    assert.deepEqual(await respond(await app(testAccess(['fees:update'])).request('/')), [
      403,
      forbidden
    ]);
  });
});

describe('guardMethods', () => {
  const app = (access: AgencyAccess) =>
    withAccess(access)
      .use(guardMethods({ GET: null, POST: 'fees:create' }))
      .all('/', (c) => c.text('ok'));

  it('lets every caller through a method mapped to null, with HEAD following GET', async () => {
    const none = app(testAccess([]));
    assert.equal((await none.request('/')).status, 200);
    assert.equal((await none.request('/', { method: 'HEAD' })).status, 200);
  });

  it('needs the permission mapped to a method', async () => {
    assert.deepEqual(await respond(await app(testAccess([])).request('/', { method: 'POST' })), [
      403,
      forbidden
    ]);
    assert.equal(
      (await app(testAccess(['fees:create'])).request('/', { method: 'POST' })).status,
      200
    );
  });

  it('guards HEAD with the GET permission', async () => {
    const guarded = (access: AgencyAccess) =>
      withAccess(access)
        .use(guardMethods({ GET: 'fees:read' }))
        .all('/', (c) => c.text('ok'));
    assert.equal((await guarded(testAccess([])).request('/', { method: 'HEAD' })).status, 403);
    assert.equal(
      (await guarded(testAccess(['fees:read'])).request('/', { method: 'HEAD' })).status,
      200
    );
  });

  it('forbids methods it does not list, even to full access', async () => {
    assert.deepEqual(await respond(await app(testAccess()).request('/', { method: 'DELETE' })), [
      403,
      forbidden
    ]);
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

  it('reads only the named resource', () => {
    assert.deepEqual(writesOn(testAccess(['fees:create', 'fees:update']), 'payers'), {
      create: false,
      update: false
    });
    assert.deepEqual(writesOn(testAccess(), 'fees'), { create: true, update: true });
  });
});
