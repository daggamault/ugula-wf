import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Api } from '../../shared/api.ts';
import { RUN_STATUSES } from '../../shared/ui/run-status-badge.tsx';
import { createRunsClient, isFinished } from './client.ts';

const signature = {
  execIn: ['exec'],
  execOut: [],
  inputs: [{ name: 'x', type: 'number' }],
  outputs: []
};

type Call = [method: string, path: string, body?: unknown];

const fakeApi = (respond: (path: string) => unknown = () => ({})) => {
  const calls: Call[] = [];
  const answer = async (call: Call) => {
    calls.push(call);
    const reply = respond(call[1]);
    if (reply instanceof Error) throw reply;
    return reply;
  };
  const api = {
    get: (path: string, signal?: AbortSignal) =>
      answer(signal ? ['GET', path, signal] : ['GET', path]),
    post: (path: string, body?: unknown) =>
      answer(body === undefined ? ['POST', path] : ['POST', path, body]),
    put: (path: string, body: unknown) => answer(['PUT', path, body]),
    remove: (path: string) => answer(['DELETE', path]),
    upload: (path: string, form: FormData) => answer(['UPLOAD', path, form]),
    href: (path: string) => path
  } as Api;
  return { api, calls };
};

describe('isFinished', () => {
  it('treats only completed, failed and cancelled runs as finished', () => {
    assert.deepEqual(
      RUN_STATUSES.filter((s) => isFinished(s)),
      ['completed', 'failed', 'cancelled']
    );
  });
});

describe('createRunsClient', () => {
  it('lists runs with the page, search and filter query', async () => {
    const { api, calls } = fakeApi(() => ({ items: ['r'], total: 1 }));
    const signal = new AbortController().signal;
    const client = createRunsClient(api);
    assert.deepEqual(await client.list('status=faulted%2Cfailed&page=1&pageSize=25', signal), {
      items: ['r'],
      total: 1
    });
    assert.deepEqual(calls, [
      ['GET', '/api/runs?status=faulted%2Cfailed&page=1&pageSize=25', signal]
    ]);
  });

  it('finds a run by its encoded id', async () => {
    const { api, calls } = fakeApi(() => ({ run: { id: 'r/1' } }));
    assert.deepEqual(await createRunsClient(api).find('r/1'), { run: { id: 'r/1' } });
    assert.deepEqual(calls, [['GET', '/api/runs/r%2F1']]);
  });

  it('unwraps the graphs and steps of a run', async () => {
    const { api, calls } = fakeApi((path) =>
      path.endsWith('/graphs') ? { graphs: ['g'] } : { steps: ['s'] }
    );
    const client = createRunsClient(api);
    assert.deepEqual(await client.graphs('r 1'), ['g']);
    assert.deepEqual(await client.steps('r 1'), ['s']);
    assert.deepEqual(calls, [
      ['GET', '/api/runs/r%201/graphs'],
      ['GET', '/api/runs/r%201/steps?limit=2000']
    ]);
  });

  it('starts a run of a graph with its inputs', async () => {
    const { api, calls } = fakeApi(() => ({ id: 'r1', version: 2 }));
    assert.deepEqual(await createRunsClient(api).start('g1', { x: 1 }), { id: 'r1', version: 2 });
    assert.deepEqual(calls, [['POST', '/api/runs', { graphId: 'g1', inputs: { x: 1 } }]]);
  });

  it('cancels a run and passes on the server error', async () => {
    const refused = Object.assign(new Error('Run already finished'), { status: 409 });
    const { api, calls } = fakeApi(() => refused);
    await assert.rejects(createRunsClient(api).cancel('r 1'), refused);
    assert.deepEqual(calls, [['POST', '/api/runs/r%201/cancel']]);
  });

  it('uploads a run input file as a form', async () => {
    const stored = { file: { bucket: 'b', key: 'k' }, name: 'a.xml' };
    const { api, calls } = fakeApi(() => stored);
    const file = new File(['<x/>'], 'a.xml');
    assert.deepEqual(await createRunsClient(api).uploadFile(file), stored);
    const [call] = calls;
    assert.equal(call?.[1], '/api/runs/files');
    const form = call?.[2];
    assert.ok(form instanceof FormData);
    assert.deepEqual([...form.keys()], ['file']);
    assert.equal((form.get('file') as File).name, 'a.xml');
  });
});

describe('createRunsClient startable', () => {
  it('resolves the signature of the first published version listed', async () => {
    const { api, calls } = fakeApi((path) =>
      path.includes('/versions/')
        ? { definition: { signature } }
        : {
            graph: { name: 'Batch' },
            versions: [
              { version: 3, published_at: null },
              { version: 2, published_at: '2026-01-01' },
              { version: 1, published_at: '2025-12-01' }
            ]
          }
    );
    assert.deepEqual(await createRunsClient(api).startable('g/1'), {
      graphId: 'g/1',
      name: 'Batch',
      version: 2,
      signature
    });
    assert.deepEqual(calls, [
      ['GET', '/api/graphs/g%2F1'],
      ['GET', '/api/graphs/g%2F1/versions/2']
    ]);
  });

  it('refuses a graph that was never published', async () => {
    const { api, calls } = fakeApi(() => ({
      graph: { name: 'Draft only' },
      versions: [{ version: 1, published_at: null }]
    }));
    await assert.rejects(createRunsClient(api).startable('g2'), {
      message: 'Draft only has no published version'
    });
    assert.equal(calls.length, 1);
  });
});
