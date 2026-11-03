import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fail, ok } from '../../shared/result.ts';
import { withSession } from '../../shared/testing.ts';
import { createGraphRoutes } from './routes.ts';
import { type GraphService, templateFor } from './service.ts';

const ID = '01a16617-7704-7ba6-b9b5-9c79fa44f965';

const calls: unknown[][] = [];

const service = {
  search: async (...args: unknown[]) => ok({ items: [], args }),
  nodes: async () => ok({ nodes: [{ key: 'demo.x' }] }),
  find: async (_t: string, id: string) =>
    id === ID ? ok({ graph: { id } }) : fail('not_found', 'Graph not found'),
  version: async (...args: unknown[]) => ok({ args }),
  validate: async () => ok({ issues: [] }),
  create: async (...args: unknown[]) => {
    calls.push(args);
    return ok({ id: ID });
  },
  saveDraft: async () => ok({ version: 2, issues: [] }),
  publish: async () => fail('invalid', 'Fix', { issues: [{ message: 'x' }] }),
  override: async (...args: unknown[]) => {
    calls.push(args);
    return ok({ id: ID });
  },
  remove: async () => fail('conflict', 'Runs still use this graph, so it cannot be removed')
} as unknown as GraphService;

const request = withSession(createGraphRoutes(service));
const definition = templateFor('workflow');

describe('graph routes', () => {
  it('serve lists, the node catalog and validation', async () => {
    assert.deepEqual(await (await request('/?q=match&show=blocks&sort=key')).json(), {
      items: [],
      args: ['t-1', { q: 'match', show: 'blocks', page: 1, pageSize: 25, sort: 'key', dir: 'asc' }]
    });
    assert.equal((await request('/?show=nope')).status, 400);
    assert.deepEqual(await (await request('/nodes')).json(), { nodes: [{ key: 'demo.x' }] });
    const validate = (body: string) => request('/validate', { method: 'POST', body });
    assert.equal((await validate(JSON.stringify({ definition }))).status, 200);
    assert.equal((await validate('{"definition":{}}')).status, 400);
  });

  it('create graphs as the session user', async () => {
    const body = JSON.stringify({ key: 'acme.new', name: 'X', kind: 'workflow' });
    assert.equal((await request('/', { method: 'POST', body })).status, 201);
    assert.deepEqual(calls[0], [
      't-1',
      'u-1',
      { key: 'acme.new', name: 'X', kind: 'workflow', description: '' }
    ]);
  });

  it('validate params and map failures to statuses', async () => {
    assert.equal((await request(`/${ID}`)).status, 200);
    assert.equal((await request('/01a16617-0000-7ba6-b9b5-9c79fa44f965')).status, 404);
    assert.equal((await request('/not-a-uuid')).status, 400);
    assert.deepEqual(await (await request(`/${ID}/versions/3`)).json(), { args: ['t-1', ID, 3] });
    const draft = await request(`/${ID}/draft`, {
      method: 'PUT',
      body: JSON.stringify({ definition })
    });
    assert.deepEqual(await draft.json(), { version: 2, issues: [] });
    const publish = await request(`/${ID}/publish`, { method: 'POST' });
    assert.equal(publish.status, 422);
    assert.deepEqual(await publish.json(), { error: 'Fix', issues: [{ message: 'x' }] });
  });
});

describe('graph route validation', () => {
  it('reject bad bodies and params before reaching the service', async () => {
    const post = (path: string, body: unknown) =>
      request(path, { method: 'POST', body: JSON.stringify(body) });
    const bad = [
      await post('/', { key: 'std.x', name: 'X', kind: 'workflow' }),
      await post('/', { key: 'acme.x', name: ' ', kind: 'workflow' }),
      await post('/', { key: 'acme.x', name: 'X', kind: 'other' }),
      await request(`/${ID}/versions/0`),
      await request('/nope/versions/1'),
      await request('/nope/draft', { method: 'PUT', body: JSON.stringify({ definition }) }),
      await request(`/${ID}/draft`, { method: 'PUT', body: '{"definition":{"nodes":[]}}' }),
      await request('/nope/publish', { method: 'POST' }),
      await request('/nope/override', { method: 'POST' }),
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

  it('override as the session user and map removal conflicts', async () => {
    const override = await request(`/${ID}/override`, { method: 'POST' });
    assert.equal(override.status, 201);
    assert.deepEqual(calls.at(-1), ['t-1', 'u-1', ID]);
    const removed = await request(`/${ID}`, { method: 'DELETE' });
    assert.equal(removed.status, 409);
    assert.deepEqual(await removed.json(), {
      error: 'Runs still use this graph, so it cannot be removed'
    });
  });
});
