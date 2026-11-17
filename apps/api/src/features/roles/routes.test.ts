import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fail, ok } from '../../shared/result.ts';
import { testAccess, withSession } from '../../shared/testing.ts';
import { createRoleRoutes } from './routes.ts';
import type { RoleService } from './service.ts';

const ID = '01a16617-7704-7ba6-b9b5-9c79fa44f965';

const FORBIDDEN = { error: 'You do not have permission to do this' };

const recordingService = () => {
  const calls: unknown[][] = [];
  const record =
    (name: string, value: unknown) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
      return name === 'permissions' ? ok(value) : Promise.resolve(ok(value));
    };
  const service = {
    search: record('search', { items: [], total: 0 }),
    permissions: record('permissions', { items: ['fees:read'] }),
    find: record('find', { role: { id: ID } }),
    create: record('create', { id: ID }),
    update: record('update', { role: { id: ID, version: 3 } }),
    remove: record('remove', { id: ID })
  } as unknown as RoleService;
  return { service, calls };
};

const send = async (
  request: ReturnType<typeof withSession>,
  path: string,
  init: RequestInit = {}
) => {
  const res = await request(path, init);
  return [res.status, await res.json()];
};

describe('role routes', () => {
  it('searches roles with paging defaults for the session access', async () => {
    const { service, calls } = recordingService();
    const access = testAccess();
    const request = withSession(createRoleRoutes(service), access);
    assert.deepEqual(await send(request, '/?q=bill'), [200, { items: [], total: 0 }]);
    assert.deepEqual(calls, [
      ['search', access, { q: 'bill', page: 1, pageSize: 25, sort: 'name', dir: 'asc' }]
    ]);
  });

  it('lists the permissions the session can grant', async () => {
    const { service, calls } = recordingService();
    const access = testAccess();
    const request = withSession(createRoleRoutes(service), access);
    assert.deepEqual(await send(request, '/permissions'), [200, { items: ['fees:read'] }]);
    assert.deepEqual(calls, [['permissions', access]]);
  });

  it('finds a role by id', async () => {
    const { service, calls } = recordingService();
    const access = testAccess();
    const request = withSession(createRoleRoutes(service), access);
    assert.deepEqual(await send(request, `/${ID}`), [200, { role: { id: ID } }]);
    assert.deepEqual(calls, [['find', access, ID]]);
  });

  it('creates a role with 201', async () => {
    const { service, calls } = recordingService();
    const access = testAccess();
    const request = withSession(createRoleRoutes(service), access);
    assert.deepEqual(
      await send(request, '/', {
        method: 'POST',
        body: JSON.stringify({ name: ' Biller ', permissions: ['fees:update', 'fees:read'] })
      }),
      [201, { id: ID }]
    );
    assert.deepEqual(calls, [
      ['create', access, { name: 'Biller', permissions: ['fees:read', 'fees:update'] }]
    ]);
  });

  it('updates a role at a version', async () => {
    const { service, calls } = recordingService();
    const access = testAccess();
    const request = withSession(createRoleRoutes(service), access);
    assert.deepEqual(
      await send(request, `/${ID}`, {
        method: 'PUT',
        body: JSON.stringify({ name: 'Biller', permissions: [], version: 2 })
      }),
      [200, { role: { id: ID, version: 3 } }]
    );
    assert.deepEqual(calls, [
      ['update', access, ID, { name: 'Biller', permissions: [], version: 2 }]
    ]);
  });

  it('deletes a role', async () => {
    const { service, calls } = recordingService();
    const access = testAccess();
    const request = withSession(createRoleRoutes(service), access);
    assert.deepEqual(await send(request, `/${ID}`, { method: 'DELETE' }), [200, { id: ID }]);
    assert.deepEqual(calls, [['remove', access, ID]]);
  });

  it('maps service failures to their status and message', async () => {
    const failing = {
      find: async () => fail('not_found', 'Role not found'),
      create: async () => fail('conflict', 'A role with that name exists'),
      remove: async () => fail('forbidden', "You can't grant permissions you don't hold")
    } as unknown as RoleService;
    const request = withSession(createRoleRoutes(failing));
    assert.deepEqual(await send(request, `/${ID}`), [404, { error: 'Role not found' }]);
    assert.deepEqual(
      await send(request, '/', {
        method: 'POST',
        body: JSON.stringify({ name: 'Biller', permissions: [] })
      }),
      [409, { error: 'A role with that name exists' }]
    );
    assert.deepEqual(await send(request, `/${ID}`, { method: 'DELETE' }), [
      403,
      { error: "You can't grant permissions you don't hold" }
    ]);
  });
});

describe('role route permissions', () => {
  const body = JSON.stringify({ name: 'x', permissions: [], version: 1 });

  it('reads roles and permissions with roles:read only', async () => {
    const { service, calls } = recordingService();
    const reader = withSession(createRoleRoutes(service), testAccess(['roles:read']));
    assert.equal((await reader('/')).status, 200);
    assert.equal((await reader('/permissions')).status, 200);
    assert.equal((await reader(`/${ID}`)).status, 200);
    const none = withSession(createRoleRoutes(service), testAccess([]));
    for (const path of ['/', '/permissions', `/${ID}`]) {
      assert.deepEqual(await send(none, path), [403, FORBIDDEN], path);
    }
    assert.deepEqual(
      calls.map(([name]) => name),
      ['search', 'permissions', 'find']
    );
  });

  it('creates, updates and deletes only with the matching permission', async () => {
    const { service, calls } = recordingService();
    const reader = withSession(createRoleRoutes(service), testAccess(['roles:read']));
    assert.deepEqual(await send(reader, '/', { method: 'POST', body }), [403, FORBIDDEN]);
    assert.deepEqual(await send(reader, `/${ID}`, { method: 'PUT', body }), [403, FORBIDDEN]);
    assert.deepEqual(await send(reader, `/${ID}`, { method: 'DELETE' }), [403, FORBIDDEN]);
    assert.equal(calls.length, 0);
    const writer = withSession(
      createRoleRoutes(service),
      testAccess(['roles:create', 'roles:update', 'roles:delete'])
    );
    assert.equal((await writer('/', { method: 'POST', body })).status, 201);
    assert.equal((await writer(`/${ID}`, { method: 'PUT', body })).status, 200);
    assert.equal((await writer(`/${ID}`, { method: 'DELETE' })).status, 200);
    assert.deepEqual(
      calls.map(([name]) => name),
      ['create', 'update', 'remove']
    );
  });
});

describe('role route validation', () => {
  it('rejects ids that are not UUIDs', async () => {
    const { service, calls } = recordingService();
    const request = withSession(createRoleRoutes(service));
    for (const init of [{}, { method: 'DELETE' }]) {
      assert.deepEqual(await send(request, '/nope', init), [
        400,
        {
          error: 'id: Invalid UUID: Received "nope"',
          issues: ['id: Invalid UUID: Received "nope"']
        }
      ]);
    }
    assert.equal(calls.length, 0);
  });

  it('rejects a blank name and a missing version', async () => {
    const { service, calls } = recordingService();
    const request = withSession(createRoleRoutes(service));
    assert.deepEqual(
      await send(request, '/', {
        method: 'POST',
        body: JSON.stringify({ name: '', permissions: [] })
      }),
      [400, { error: 'name: Enter a name', issues: ['name: Enter a name'] }]
    );
    assert.deepEqual(
      await send(request, `/${ID}`, {
        method: 'PUT',
        body: JSON.stringify({ name: 'x', permissions: [] })
      }),
      [
        400,
        {
          error: 'version: Invalid key: Expected "version" but received undefined',
          issues: ['version: Invalid key: Expected "version" but received undefined']
        }
      ]
    );
    assert.equal(calls.length, 0);
  });

  it('rejects unknown sorts', async () => {
    const { service } = recordingService();
    const request = withSession(createRoleRoutes(service));
    assert.equal((await request('/?sort=nope')).status, 400);
  });
});
