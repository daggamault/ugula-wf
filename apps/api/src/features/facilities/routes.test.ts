import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ok } from '../../shared/result.ts';
import { withSession } from '../../shared/testing.ts';
import { createFacilityRoutes } from './routes.ts';
import type { FacilityService } from './service.ts';

const ID = '01a16617-7704-7ba6-b9b5-9c79fa44f965';

const calls: unknown[][] = [];
const record =
  (name: string, value: unknown) =>
  async (...args: unknown[]) => {
    calls.push([name, ...args]);
    return ok(value);
  };

const service = {
  search: record('search', { items: [], total: 0, page: 1, pageSize: 25 }),
  find: record('find', { facility: { id: ID } }),
  create: record('create', { id: ID }),
  update: record('update', { id: ID }),
  remove: record('remove', { status: 'deleted' })
} as unknown as FacilityService;

const request = withSession(createFacilityRoutes(service));

describe('facility routes', () => {
  it('lists, reads, creates, updates and deletes facilities of the session agency', async () => {
    assert.equal((await request('/?q=sun')).status, 200);
    assert.equal((await request(`/${ID}`)).status, 200);
    const body = JSON.stringify({ name: 'Sunrise SNF' });
    assert.equal((await request('/', { method: 'POST', body })).status, 201);
    assert.equal((await request(`/${ID}`, { method: 'PUT', body })).status, 200);
    assert.equal((await request(`/${ID}`, { method: 'DELETE' })).status, 200);
    assert.equal((await request('/', { method: 'POST', body: '{}' })).status, 400);
    assert.deepEqual(
      calls.map(([name, agency]) => [name, agency]),
      [
        ['search', 't-1'],
        ['find', 't-1'],
        ['create', 't-1'],
        ['update', 't-1'],
        ['remove', 't-1']
      ]
    );
  });
});
