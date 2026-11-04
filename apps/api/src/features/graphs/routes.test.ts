import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AgencyAccess } from '../../shared/access.ts';
import { fail, ok } from '../../shared/result.ts';
import { testAccess, withSession } from '../../shared/testing.ts';
import { createGraphRoutes } from './routes.ts';
import { type GraphService, templateFor } from './service.ts';

const ID = '01a16617-7704-7ba6-b9b5-9c79fa44f965';

const calls: unknown[][] = [];

const record =
  <T>(value: T) =>
  async (...args: unknown[]) => {
    calls.push(args);
    return value;
  };

const service = {
  search: async (access: AgencyAccess, filters: unknown) =>
    ok({ items: [], args: [access.agencyId, filters] }),
  nodes: async () => ok({ nodes: [{ key: 'demo.x' }] }),
  find: async (_a: AgencyAccess, id: string) =>
    id === ID ? ok({ graph: { id } }) : fail('not_found', 'Graph not found'),
  compare: record(ok({ mine: null, copiedFrom: null, latest: null, baseChanged: false })),
  version: async (_a: AgencyAccess, id: string, version: number) => ok({ args: [id, version] }),
  validate: async () => ok({ issues: [] }),
  create: record(ok({ id: ID })),
  saveDraft: async () => ok({ version: 2, issues: [] }),
  publish: async () => fail('invalid', 'Fix', { issues: [{ message: 'x' }] }),
  override: record(ok({ id: ID })),
  rebase: record(ok({ id: ID })),
  remove: async () => fail('conflict', 'Runs still use this graph, so it cannot be removed')
} as unknown as GraphService;

const access = testAccess();
const request = withSession(createGraphRoutes(service), access);
const definition = templateFor('workflow');
const post = (path: string, body?: unknown) =>
  request(path, { method: 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

describe('graph routes', () => {
  it('serve lists, the node catalog and validation', async () => {
    assert.deepEqual(await (await request('/?q=match&show=blocks&sort=key')).json(), {
      items: [],
      args: ['t-1', { q: 'match', show: 'blocks', page: 1, pageSize: 25, sort: 'key', dir: 'asc' }]
    });
    assert.equal((await request('/?show=nope')).status, 400);
    assert.deepEqual(await (await request('/nodes')).json(), { nodes: [{ key: 'demo.x' }] });
    assert.equal((await post('/validate', { definition })).status, 200);
    assert.equal((await post('/validate', { definition: {} })).status, 400);
  });

  it('create graphs with the agency access and a scope', async () => {
    assert.equal((await post('/', { key: 'acme.new', name: 'X', kind: 'workflow' })).status, 201);
    assert.deepEqual(calls.at(-1), [
      access,
      { key: 'acme.new', name: 'X', kind: 'workflow', description: '', scope: 'agency' }
    ]);
    await post('/', { key: 'acme.org', name: 'X', kind: 'node', scope: 'organization' });
    assert.deepEqual(calls.at(-1)?.[1], {
      key: 'acme.org',
      name: 'X',
      kind: 'node',
      description: '',
      scope: 'organization'
    });
  });

  it('validate params and map failures to statuses', async () => {
    assert.equal((await request(`/${ID}`)).status, 200);
    assert.equal((await request('/01a16617-0000-7ba6-b9b5-9c79fa44f965')).status, 404);
    assert.equal((await request('/not-a-uuid')).status, 400);
    assert.deepEqual(await (await request(`/${ID}/versions/3`)).json(), { args: [ID, 3] });
    const draft = await request(`/${ID}/draft`, {
      method: 'PUT',
      body: JSON.stringify({ definition })
    });
    assert.deepEqual(await draft.json(), { version: 2, issues: [] });
    const publish = await post(`/${ID}/publish`);
    assert.equal(publish.status, 422);
    assert.deepEqual(await publish.json(), { error: 'Fix', issues: [{ message: 'x' }] });
  });

  it('compare a graph with the graph it overrides', async () => {
    const res = await request(`/${ID}/compare`);
    assert.deepEqual(await res.json(), {
      mine: null,
      copiedFrom: null,
      latest: null,
      baseChanged: false
    });
    assert.deepEqual(calls.at(-1), [access, ID]);
    assert.equal((await request('/nope/compare')).status, 400);
  });
});

describe('graph route validation', () => {
  it('reject bad bodies and params before reaching the service', async () => {
    const bad = [
      await post('/', { key: 'std.x', name: 'X', kind: 'workflow' }),
      await post('/', { key: 'acme.x', name: ' ', kind: 'workflow' }),
      await post('/', { key: 'acme.x', name: 'X', kind: 'other' }),
      await post('/', { key: 'acme.x', name: 'X', kind: 'node', scope: 'system' }),
      await request(`/${ID}/versions/0`),
      await request('/nope/versions/1'),
      await request('/nope/draft', { method: 'PUT', body: JSON.stringify({ definition }) }),
      await request(`/${ID}/draft`, { method: 'PUT', body: '{"definition":{"nodes":[]}}' }),
      await post('/nope/publish'),
      await post('/nope/override', {}),
      await post(`/${ID}/override`, { scope: 'system' }),
      await post(`/${ID}/rebase`, { mode: 'merge' }),
      await post('/nope/rebase', { mode: 'keep' }),
      await request('/nope', { method: 'DELETE' })
    ];
    assert.deepEqual(
      bad.map((r) => r.status),
      bad.map(() => 400)
    );
    assert.deepEqual(await bad[0]?.json(), {
      error: 'key: The std namespace is reserved',
      issues: ['key: The std namespace is reserved']
    });
  });

  it('override for a scope, rebase by mode and map removal conflicts', async () => {
    assert.equal((await post(`/${ID}/override`, {})).status, 201);
    assert.deepEqual(calls.at(-1), [access, ID, 'agency']);
    await post(`/${ID}/override`, { scope: 'organization' });
    assert.deepEqual(calls.at(-1), [access, ID, 'organization']);
    assert.equal((await post(`/${ID}/rebase`, { mode: 'reset' })).status, 200);
    assert.deepEqual(calls.at(-1), [access, ID, 'reset']);
    const removed = await request(`/${ID}`, { method: 'DELETE' });
    assert.equal(removed.status, 409);
    assert.deepEqual(await removed.json(), {
      error: 'Runs still use this graph, so it cannot be removed'
    });
  });
});
