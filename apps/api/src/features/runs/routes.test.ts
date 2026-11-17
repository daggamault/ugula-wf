import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Permission } from '@ugula/access';
import { fail, ok } from '../../shared/result.ts';
import { testAccess, withSession } from '../../shared/testing.ts';
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
  search: record({ runs: [] }),
  find: record({ run: { id: ID } }),
  graphs: record({ graphs: [] }),
  steps: record({ steps: [] }),
  start: record({ id: 'r1', version: 1 }),
  cancel: async () => fail('conflict', 'Run already finished'),
  uploadFile: record({ file: { bucket: 'b', key: 'k' }, name: 'a.xml' }),
  maxBytes: 1_000
} as unknown as RunService;

const request = withSession(createRunRoutes(service));

describe('run routes', () => {
  it('translate query filters', async () => {
    await request(
      '/?q=ingest&status=faulted,failed&workflow=demo.batch&root=false&page=3&sort=workflow&dir=asc'
    );
    assert.deepEqual(calls.at(-1), [
      't-1',
      {
        q: 'ingest',
        rootOnly: false,
        status: ['faulted', 'failed'],
        workflow: ['demo.batch'],
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
    assert.deepEqual(await started.json(), { id: 'r1', version: 1 });
    assert.deepEqual(calls.at(-1), [{ agencyId: 't-1' }, 'u-1', ID, undefined, {}]);
    const signal = await request('/signals', { method: 'POST', body: '{"name":"ack","key":"C1"}' });
    assert.equal(signal.status, 404);
  });

  it('serve run detail and the bundle and reject bad ids', async () => {
    const detail = await request(`/${ID}`);
    assert.deepEqual([detail.status, await detail.json()], [200, { run: { id: ID } }]);
    assert.deepEqual(calls.at(-1), ['t-1', ID]);
    const graphs = await request(`/${ID}/graphs`);
    assert.deepEqual([graphs.status, await graphs.json()], [200, { graphs: [] }]);
    assert.deepEqual(calls.at(-1), ['t-1', ID]);
    assert.equal((await request('/nope')).status, 400);
  });

  it('map cancel conflicts', async () => {
    const res = await request(`/${ID}/cancel`, { method: 'POST' });
    assert.deepEqual([res.status, await res.json()], [409, { error: 'Run already finished' }]);
  });

  it('accept a cancel of an active run in the session agency', async () => {
    const cancels: unknown[][] = [];
    const accepting = withSession(
      createRunRoutes({
        ...service,
        cancel: async (...args: unknown[]) => {
          cancels.push(args);
          return ok({ status: 'cancelling' });
        }
      } as unknown as RunService)
    );
    const res = await accepting(`/${ID}/cancel`, { method: 'POST' });
    assert.deepEqual([res.status, await res.json()], [202, { status: 'cancelling' }]);
    assert.deepEqual(cancels, [['t-1', ID]]);
  });

  it('map runs missing from the agency to 404', async () => {
    const missing = withSession(
      createRunRoutes({
        ...service,
        find: async () => fail('not_found', 'Run not found'),
        steps: async () => fail('not_found', 'Run not found')
      } as unknown as RunService)
    );
    for (const path of [`/${ID}`, `/${ID}/steps`]) {
      const res = await missing(path);
      assert.deepEqual([res.status, await res.json()], [404, { error: 'Run not found' }], path);
    }
  });
});

describe('run input file uploads', () => {
  it('accepts a file form and rejects a form without a file', async () => {
    const form = new FormData();
    form.set('file', new File(['<x/>'], 'a.xml', { type: 'text/xml' }));
    assert.equal((await request('/files', { method: 'POST', body: form })).status, 201);
    assert.deepEqual(calls.at(-1), [
      't-1',
      { name: 'a.xml', type: 'text/xml', bytes: new TextEncoder().encode('<x/>') }
    ]);
    assert.equal((await request('/files', { method: 'POST', body: new FormData() })).status, 400);
  });
});

describe('run route validation', () => {
  it('pass top-level runs and step narrowing through and reject bad values', async () => {
    await request('/?root=true');
    assert.deepEqual(calls.at(-1), [
      't-1',
      {
        rootOnly: true,
        status: [],
        workflow: [],
        page: 1,
        pageSize: 25,
        sort: 'started',
        dir: 'desc'
      }
    ]);
    await request(`/${ID}/steps?node=n1&limit=20`);
    assert.deepEqual(calls.at(-1), ['t-1', ID, { node: 'n1', after: 0, limit: 20 }]);
    const count = calls.length;
    const bad = [
      await request('/?status=running,odd'),
      await request('/?root=yes'),
      await request('/?sort=key'),
      await request(`/${ID}/steps?limit=0`),
      await request(`/${ID}/steps?limit=2001`),
      await request(`/${ID}/steps?after=-1`),
      await request('/nope/steps'),
      await request('/nope/graphs'),
      await request('/nope/cancel', { method: 'POST' }),
      await request('/', { method: 'POST', body: JSON.stringify({ graphId: ID, version: 1.5 }) }),
      await request('/', { method: 'POST', body: JSON.stringify({ graphId: 'nope' }) })
    ];
    assert.deepEqual(
      bad.map((r) => r.status),
      bad.map(() => 400)
    );
    assert.equal(calls.length, count);
  });

  it('start a chosen version with its inputs', async () => {
    const body = JSON.stringify({ graphId: ID, version: 2, inputs: { a: 1 } });
    assert.equal((await request('/', { method: 'POST', body })).status, 201);
    assert.deepEqual(calls.at(-1), [{ agencyId: 't-1' }, 'u-1', ID, 2, { a: 1 }]);
  });

  it('refuse files larger than the upload limit', async () => {
    const form = new FormData();
    form.set('file', new File(['x'.repeat(100_000)], 'big.xml'));
    const res = await request('/files', { method: 'POST', body: form });
    assert.equal(res.status, 413);
    assert.deepEqual(await res.json(), { error: 'File too large' });
  });

  it('start runs and upload their files with runs:create, and cancel with runs:update', async () => {
    const as = (permissions: Permission[]) =>
      withSession(createRunRoutes(service), testAccess(permissions));
    const start = { method: 'POST', body: JSON.stringify({ graphId: ID }) };
    const upload = () => {
      const form = new FormData();
      form.set('file', new File(['<x/>'], 'a.xml'));
      return { method: 'POST', body: form };
    };
    const starter = as(['runs:read', 'runs:create']);
    assert.equal((await starter('/', start)).status, 201);
    assert.equal((await starter('/files', upload())).status, 201);
    assert.equal((await starter(`/${ID}/cancel`, { method: 'POST' })).status, 403);
    const canceller = as(['runs:read', 'runs:update']);
    assert.equal((await canceller('/', start)).status, 403);
    assert.equal((await canceller('/files', upload())).status, 403);
    assert.equal((await canceller(`/${ID}/cancel`, { method: 'POST' })).status, 409);
  });
});
