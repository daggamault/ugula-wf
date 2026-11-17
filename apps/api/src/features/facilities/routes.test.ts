import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fail, ok } from '../../shared/result.ts';
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
  hospitals: record('hospitals', { hospitals: [] }),
  find: record('find', { facility: { id: ID } }),
  create: record('create', { id: ID }),
  update: record('update', { id: ID }),
  remove: record('remove', { id: ID })
} as unknown as FacilityService;

const request = withSession(createFacilityRoutes(service));

const SAVED = {
  name: 'Sunrise SNF',
  addressLine: null,
  city: null,
  state: null,
  postalCode: null,
  phone: null,
  kind: 'other',
  hasContract: false,
  contractNote: null
};

describe('facility routes', () => {
  it('lists, reads, creates, updates and deletes facilities of the session agency', async () => {
    const list = await request('/?q=sun');
    assert.equal(list.status, 200);
    assert.deepEqual(await list.json(), { items: [], total: 0, page: 1, pageSize: 25 });
    assert.deepEqual(await (await request('/hospitals?q=mercy')).json(), { hospitals: [] });
    assert.deepEqual(await (await request(`/${ID}`)).json(), { facility: { id: ID } });
    const body = JSON.stringify({ name: ' Sunrise SNF ' });
    const created = await request('/', { method: 'POST', body });
    assert.equal(created.status, 201);
    assert.deepEqual(await created.json(), { id: ID });
    assert.equal((await request(`/${ID}`, { method: 'PUT', body })).status, 200);
    assert.equal((await request(`/${ID}`, { method: 'DELETE' })).status, 200);
    assert.deepEqual(calls, [
      ['search', 't-1', { q: 'sun', page: 1, pageSize: 25, sort: 'name', dir: 'asc' }],
      ['hospitals', 'mercy'],
      ['find', 't-1', ID],
      ['create', 't-1', SAVED],
      ['update', 't-1', ID, SAVED],
      ['remove', 't-1', ID]
    ]);
  });

  it('rejects bad bodies, ids and sorts before reaching the service', async () => {
    const before = calls.length;
    const body = JSON.stringify({ name: 'Sunrise SNF' });
    const bad = [
      await request('/', { method: 'POST', body: '{}' }),
      await request('/', { method: 'POST', body: JSON.stringify({ name: 'X', state: 'ILL' }) }),
      await request('/nope', { method: 'PUT', body }),
      await request('/nope', { method: 'DELETE' }),
      await request('/nope'),
      await request('/?sort=kind')
    ];
    assert.deepEqual(
      bad.map((r) => r.status),
      bad.map(() => 400)
    );
    assert.equal(calls.length, before);
  });
});

describe('facility route failures', () => {
  it('maps missing facilities to 404 and taken names and facilities in use to 409', async () => {
    const failing = withSession(
      createFacilityRoutes({
        find: async () => fail('not_found', 'Facility not found'),
        create: async () => fail('conflict', 'A facility named Sunrise SNF already exists'),
        update: async () => fail('not_found', 'Facility not found'),
        remove: async () => fail('conflict', 'In use')
      } as unknown as FacilityService)
    );
    const body = JSON.stringify({ name: 'Sunrise SNF' });
    const missing = await failing(`/${ID}`);
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: 'Facility not found' });
    assert.equal((await failing(`/${ID}`, { method: 'PUT', body })).status, 404);
    const taken = await failing('/', { method: 'POST', body });
    assert.equal(taken.status, 409);
    assert.deepEqual(await taken.json(), { error: 'A facility named Sunrise SNF already exists' });
    assert.equal((await failing(`/${ID}`, { method: 'DELETE' })).status, 409);
  });
});
