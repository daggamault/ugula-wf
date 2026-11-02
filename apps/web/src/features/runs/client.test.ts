import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApi } from '../../shared/api.ts';
import { createRunsClient, isFinished } from './client.ts';

const signature = {
  execIn: ['exec'],
  execOut: [],
  inputs: [{ name: 'x', type: 'number' }],
  outputs: []
};

const routes: Record<string, unknown> = {
  'GET /api/runs?status=faulted&page=1&pageSize=25&sort=started&dir=desc': {
    items: ['r'],
    total: 1
  },
  'GET /api/runs?page=2': { items: [], total: 30 },
  'GET /api/runs/r1/graphs': { graphs: ['g'] },
  'GET /api/runs/r1/steps?limit=2000': { steps: ['s'] },
  'GET /api/graphs/g1': {
    graph: { name: 'Batch' },
    versions: [
      { version: 3, published_at: null },
      { version: 2, published_at: '2026-01-01' }
    ]
  },
  'GET /api/graphs/g1/versions/2': { definition: { signature } },
  'GET /api/graphs/g2': {
    graph: { name: 'Draft only' },
    versions: [{ version: 1, published_at: null }]
  }
};

const client = createRunsClient(
  createApi('', async (url, init = {}) => {
    const body = routes[`${init.method} ${String(url)}`] ?? {};
    return new Response(JSON.stringify(body), { status: 200 });
  })
);

describe('isFinished', () => {
  it('treats only terminal statuses as finished, so stuck runs stay live', () => {
    assert.equal(isFinished('faulted'), false);
    assert.equal(isFinished('suspended'), false);
    assert.equal(isFinished('cancelled'), true);
  });
});

describe('createRunsClient', () => {
  it('unwraps run lists, bundles and steps', async () => {
    assert.deepEqual(await client.list('faulted', 'page=1&pageSize=25&sort=started&dir=desc'), {
      items: ['r'],
      total: 1
    });
    assert.deepEqual(await client.list(null, 'page=2'), { items: [], total: 30 });
    assert.deepEqual(await client.graphs('r1'), ['g']);
    assert.deepEqual(await client.steps('r1'), ['s']);
  });

  it('resolves the latest published signature to start a run', async () => {
    assert.deepEqual(await client.startable('g1'), {
      graphId: 'g1',
      name: 'Batch',
      version: 2,
      signature
    });
    await assert.rejects(() => client.startable('g2'), /has no published version/);
  });
});

describe('run input files', () => {
  it('uploads a file as a form and returns its stored reference', async () => {
    const seen: string[] = [];
    const uploads = createRunsClient(
      createApi('', async (url, init = {}) => {
        seen.push(`${init.method} ${String(url)} ${init.body instanceof FormData}`);
        return new Response(JSON.stringify({ file: { bucket: 'b', key: 'k' }, name: 'a.xml' }), {
          status: 201
        });
      })
    );
    assert.deepEqual(await uploads.uploadFile(new File(['<x/>'], 'a.xml')), {
      file: { bucket: 'b', key: 'k' },
      name: 'a.xml'
    });
    assert.deepEqual(seen, ['POST /api/runs/files true']);
  });
});
