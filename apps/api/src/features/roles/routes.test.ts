import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ok } from '../../shared/result.ts';
import { testAccess, withSession } from '../../shared/testing.ts';
import { createRoleRoutes } from './routes.ts';
import type { RoleService } from './service.ts';

const ID = '01a16617-7704-7ba6-b9b5-9c79fa44f965';

const calls: unknown[][] = [];

const record =
  (name: string, value: unknown = {}) =>
  (...args: unknown[]) => {
    calls.push([name, ...args.slice(1)]);
    return name === 'permissions' ? ok(value) : Promise.resolve(ok(value));
  };

const service = {
  list: record('list', { items: [] }),
  permissions: record('permissions', { items: [] }),
  find: record('find'),
  create: record('create', { id: ID }),
  update: record('update'),
  remove: record('remove', { id: ID })
} as unknown as RoleService;

describe('role routes', () => {
  it('lists, finds, creates, updates and deletes roles', async () => {
    const request = withSession(createRoleRoutes(service));
    assert.equal((await request('/?q=bill')).status, 200);
    assert.equal((await request('/permissions')).status, 200);
    assert.equal((await request(`/${ID}`)).status, 200);
    const created = await request('/', {
      method: 'POST',
      body: JSON.stringify({ name: 'Biller', permissions: ['fees:read'] })
    });
    assert.equal(created.status, 201);
    assert.equal(
      (
        await request(`/${ID}`, {
          method: 'PUT',
          body: JSON.stringify({ name: 'Biller', permissions: [], version: 2 })
        })
      ).status,
      200
    );
    assert.equal((await request(`/${ID}`, { method: 'DELETE' })).status, 200);
    assert.deepEqual(calls, [
      ['list', { q: 'bill', page: 1, pageSize: 25, sort: 'name', dir: 'asc' }],
      ['permissions'],
      ['find', ID],
      ['create', { name: 'Biller', permissions: ['fees:read'] }],
      ['update', ID, { name: 'Biller', permissions: [], version: 2 }],
      ['remove', ID]
    ]);
  });

  it('requires the matching roles permission for each action', async () => {
    calls.length = 0;
    const request = withSession(createRoleRoutes(service), testAccess(['roles:read']));
    assert.equal((await request('/')).status, 200);
    const body = JSON.stringify({ name: 'x', permissions: [], version: 1 });
    assert.equal((await request('/', { method: 'POST', body })).status, 403);
    assert.equal((await request(`/${ID}`, { method: 'PUT', body })).status, 403);
    assert.equal((await request(`/${ID}`, { method: 'DELETE' })).status, 403);
    assert.equal((await withSession(createRoleRoutes(service), testAccess([]))('/')).status, 403);
    assert.equal(calls.length, 1);
  });

  it('rejects bad ids and bodies', async () => {
    const request = withSession(createRoleRoutes(service));
    assert.equal((await request('/nope')).status, 400);
    assert.equal(
      (await request('/', { method: 'POST', body: JSON.stringify({ name: '', permissions: [] }) }))
        .status,
      400
    );
    assert.equal(
      (
        await request(`/${ID}`, {
          method: 'PUT',
          body: JSON.stringify({ name: 'x', permissions: [] })
        })
      ).status,
      400
    );
  });
});
