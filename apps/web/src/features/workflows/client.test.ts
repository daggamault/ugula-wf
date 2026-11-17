import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { GraphDef } from '@ugula/graph';
import { createApi } from '../../shared/api.ts';
import { createWorkflowsClient } from './client.ts';

type Call = { method: string | undefined; url: string; body: unknown; signal: boolean };

const recording = (reply: unknown = {}, status = 200) => {
  const calls: Call[] = [];
  const client = createWorkflowsClient(
    createApi(
      'http://api.test',
      async (url, init = {}) => {
        calls.push({
          method: init.method,
          url: String(url),
          body: init.body === undefined ? undefined : JSON.parse(String(init.body)),
          signal: init.signal !== undefined
        });
        return Response.json(reply, { status });
      },
      () => undefined,
      () => null
    )
  );
  return { client, calls };
};

const get = (url: string, signal = false): Call => ({
  method: 'GET',
  url: `http://api.test${url}`,
  body: undefined,
  signal
});

const def: GraphDef = {
  signature: { execIn: [], execOut: [], inputs: [], outputs: [] },
  variables: [],
  nodes: [],
  edges: []
};

describe('createWorkflowsClient graphs', () => {
  it('searches workflows with the given query and forwards the abort signal', async () => {
    const page = { items: [], total: 0, page: 1, pageSize: 25 };
    const { client, calls } = recording(page);
    assert.deepEqual(await client.search('show=all&q=bat', new AbortController().signal), page);
    assert.deepEqual(calls, [get('/api/graphs?show=all&q=bat', true)]);
  });

  it('unwraps the published node types', async () => {
    const { client, calls } = recording({ nodes: [{ type: 'std.expr' }] });
    assert.deepEqual(await client.nodes(), [{ type: 'std.expr' }]);
    assert.deepEqual(calls, [get('/api/graphs/nodes')]);
  });

  it('reads the customization map, a workflow, its comparison and a version', async () => {
    const { client, calls } = recording({ id: 'g' });
    const signal = new AbortController().signal;
    assert.deepEqual(await client.map(signal), { id: 'g' });
    await client.find('a/b', signal);
    await client.compare('a/b', signal);
    await client.version('a/b', 3);
    assert.deepEqual(calls, [
      get('/api/graphs/map', true),
      get('/api/graphs/a%2Fb', true),
      get('/api/graphs/a%2Fb/compare', true),
      get('/api/graphs/a%2Fb/versions/3')
    ]);
  });

  it('creates a workflow and saves its draft definition', async () => {
    const { client, calls } = recording({ id: 'g1' });
    const input = { key: 'a.b', name: 'A', kind: 'node' as const, description: '' };
    assert.deepEqual(await client.create(input), { id: 'g1' });
    await client.saveDraft('a/b', def);
    assert.deepEqual(calls, [
      { method: 'POST', url: 'http://api.test/api/graphs', body: input, signal: false },
      {
        method: 'PUT',
        url: 'http://api.test/api/graphs/a%2Fb/draft',
        body: { definition: def },
        signal: false
      }
    ]);
  });

  it('publishes, overrides, rebases and removes a workflow', async () => {
    const { client, calls } = recording({ id: 'g1' });
    await client.publish('a/b');
    await client.override('a/b');
    await client.rebase('a/b', 'keep');
    await client.rebase('a/b', 'reset');
    assert.deepEqual(await client.remove('a/b'), { id: 'g1' });
    const post = (url: string, body?: unknown): Call => ({
      method: 'POST',
      url: `http://api.test${url}`,
      body,
      signal: false
    });
    assert.deepEqual(calls, [
      post('/api/graphs/a%2Fb/publish'),
      post('/api/graphs/a%2Fb/override'),
      post('/api/graphs/a%2Fb/rebase', { mode: 'keep' }),
      post('/api/graphs/a%2Fb/rebase', { mode: 'reset' }),
      { method: 'DELETE', url: 'http://api.test/api/graphs/a%2Fb', body: undefined, signal: false }
    ]);
  });

  it('rejects with the server error, its status and its issues', async () => {
    const { client } = recording({ error: 'Graph has problems', issues: [{ message: 'x' }] }, 422);
    await assert.rejects(client.publish('g'), {
      message: 'Graph has problems',
      status: 422,
      body: { error: 'Graph has problems', issues: [{ message: 'x' }] }
    });
  });
});

describe('createWorkflowsClient tables', () => {
  it('searches tables and unwraps the tables in effect', async () => {
    const { client, calls } = recording({ tables: [{ key: 'k' }] });
    const signal = new AbortController().signal;
    assert.deepEqual(await client.tables.search('show=customized', signal), {
      tables: [{ key: 'k' }]
    });
    assert.deepEqual(await client.tables.effective(), [{ key: 'k' }]);
    assert.deepEqual(calls, [
      get('/api/tables?show=customized', true),
      get('/api/tables/effective')
    ]);
  });

  it('reads a table, its comparison and a version by encoded id', async () => {
    const { client, calls } = recording({ id: 't' });
    const signal = new AbortController().signal;
    await client.tables.find('t/1', signal);
    await client.tables.compare('t/1', signal);
    await client.tables.version('t/1', 2);
    assert.deepEqual(calls, [
      get('/api/tables/t%2F1', true),
      get('/api/tables/t%2F1/compare', true),
      get('/api/tables/t%2F1/versions/2')
    ]);
  });

  it('saves, publishes, overrides and removes a table', async () => {
    const { client, calls } = recording({ version: 2 });
    assert.deepEqual(await client.tables.saveDraft('t/1', { rows: [] }), { version: 2 });
    await client.tables.publish('t/1');
    await client.tables.override('t/1');
    await client.tables.remove('t/1');
    const call = (method: string, url: string, body?: unknown): Call => ({
      method,
      url: `http://api.test${url}`,
      body,
      signal: false
    });
    assert.deepEqual(calls, [
      call('PUT', '/api/tables/t%2F1/draft', { definition: { rows: [] } }),
      call('POST', '/api/tables/t%2F1/publish'),
      call('POST', '/api/tables/t%2F1/override'),
      call('DELETE', '/api/tables/t%2F1')
    ]);
  });
});
