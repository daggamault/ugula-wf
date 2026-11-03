import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fail, ok } from '../../shared/result.ts';
import { withSession } from '../../shared/testing.ts';
import { createRunRoutes } from './routes.ts';
import type { RunService } from './service.ts';

const ID = '01a16617-7704-7ba6-b9b5-9c79fa44f965';

const calls: unknown[][] = [];
const record =
  (value: unknown) =>
  async (...args: unknown[]) => {
    calls.push(args);
    return ok(value);
  };

const service = {
  list: record({ runs: [] }),
  find: record({ run: { id: ID } }),
  graphs: record({ graphs: [] }),
  steps: record({ steps: [] }),
  start: record({ id: 'r1', version: 1 }),
  cancel: async () => fail('conflict', 'Run already finished'),
  uploadFile: record({ file: { bucket: 'b', key: 'k' }, name: 'a.xml' })
} as unknown as RunService;

const request = withSession(createRunRoutes(service, 1_000));

describe('run routes', () => {
  it('translate query filters', async () => {
    await request('/?q=ingest&status=faulted&root=false&page=3&sort=workflow&dir=asc');
    assert.deepEqual(calls.at(-1), [
      't-1',
      {
        q: 'ingest',
        status: 'faulted',
        rootOnly: false,
        page: 3,
        pageSize: 25,
        sort: 'workflow',
        dir: 'asc'
      }
    ]);
    await request(`/${ID}/steps?path=sub/&after=3`);
    assert.deepEqual(calls.at(-1), ['t-1', ID, { path: 'sub/', after: 3, limit: 500 }]);
  });

  it('start runs and accept no signals from users', async () => {
    const started = await request('/', { method: 'POST', body: JSON.stringify({ graphId: ID }) });
    assert.equal(started.status, 201);
    assert.deepEqual(calls.at(-1), ['t-1', ID, undefined, {}]);
    const signal = await request('/signals', { method: 'POST', body: '{"name":"ack","key":"C1"}' });
    assert.equal(signal.status, 404);
  });

  it('serve run detail and the bundle and reject bad ids', async () => {
    assert.equal((await request(`/${ID}`)).status, 200);
    assert.equal((await request(`/${ID}/graphs`)).status, 200);
    assert.equal((await request('/nope')).status, 400);
  });

  it('map cancel conflicts', async () => {
    assert.equal((await request(`/${ID}/cancel`, { method: 'POST' })).status, 409);
  });
});

describe('run input file uploads', () => {
  it('accepts a file form and rejects a form without a file', async () => {
    const form = new FormData();
    form.set('file', new File(['<x/>'], 'a.xml', { type: 'text/xml' }));
    assert.equal((await request('/files', { method: 'POST', body: form })).status, 201);
    assert.equal((await request('/files', { method: 'POST', body: new FormData() })).status, 400);
  });
});
