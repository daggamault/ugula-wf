import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApi } from '../../shared/api.ts';
import { createWorkflowsClient } from './client.ts';

describe('createWorkflowsClient', () => {
  it('calls the graph endpoints and unwraps payloads', async () => {
    const calls: string[] = [];
    const client = createWorkflowsClient(
      createApi('', async (url, init = {}) => {
        calls.push(`${init.method} ${String(url)}`);
        const body = String(url).endsWith('/nodes') ? { nodes: [1] } : { items: [2], version: 3 };
        return new Response(JSON.stringify(body), { status: 200 });
      })
    );
    assert.deepEqual((await client.search('show=all&q=bat')).items, [2]);
    assert.deepEqual(await client.nodes(), [1]);
    await client.find('g');
    await client.version('g', 3);
    await client.create({ key: 'a.b', name: 'A', kind: 'node', description: '' });
    await client.saveDraft('g', {
      signature: { execIn: [], execOut: [], inputs: [], outputs: [] },
      variables: [],
      nodes: [],
      edges: []
    });
    await client.publish('g');
    await client.override('g');
    await client.remove('a/b');
    assert.deepEqual(calls, [
      'GET /api/graphs?show=all&q=bat',
      'GET /api/graphs/nodes',
      'GET /api/graphs/g',
      'GET /api/graphs/g/versions/3',
      'POST /api/graphs',
      'PUT /api/graphs/g/draft',
      'POST /api/graphs/g/publish',
      'POST /api/graphs/g/override',
      'DELETE /api/graphs/a%2Fb'
    ]);
  });
});

describe('workflows client errors', () => {
  it('surfaces API errors with their issues', async () => {
    const client = createWorkflowsClient(
      createApi(
        '',
        async () =>
          new Response('{"error":"Graph has problems","issues":[{"message":"x"}]}', {
            status: 422
          })
      )
    );
    await assert.rejects(
      () => client.publish('g'),
      (err: Error & { status?: number; body?: Record<string, unknown> }) =>
        err.message === 'Graph has problems' &&
        err.status === 422 &&
        Array.isArray(err.body?.issues)
    );
  });
});
