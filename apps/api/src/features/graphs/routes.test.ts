import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fail, ok } from '../../shared/result.ts';
import { withSession } from '../../shared/testing.ts';
import { createGraphRoutes } from './routes.ts';
import { type GraphService, templateFor } from './service.ts';

const ID = '01a16617-7704-7ba6-b9b5-9c79fa44f965';

const calls: unknown[][] = [];

const service = {
  list: async () => ok({ graphs: [] }),
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
  publish: async () => fail('invalid', 'Fix', { issues: [{ message: 'x' }] })
} as unknown as GraphService;

const request = withSession(createGraphRoutes(service));
const definition = templateFor('workflow');

describe('graph routes', () => {
  it('serve lists, the node catalog and validation', async () => {
    assert.deepEqual(await (await request('/')).json(), { graphs: [] });
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
