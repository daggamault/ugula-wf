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
  signal: record({ resumed: 3 })
} as unknown as RunService;

const request = withSession(createRunRoutes(service));

describe('run routes', () => {
  it('translate query filters', async () => {
    await request('/?status=faulted&root=false&page=3&sort=workflow&dir=asc');
    assert.deepEqual(calls.at(-1), [
      't-1',
      { status: 'faulted', rootOnly: false, page: 3, pageSize: 25, sort: 'workflow', dir: 'asc' }
    ]);
    await request(`/${ID}/steps?path=sub/&after=3`);
    assert.deepEqual(calls.at(-1), ['t-1', ID, { path: 'sub/', after: 3, limit: 500 }]);
  });

  it('start runs and deliver signals', async () => {
    const started = await request('/', { method: 'POST', body: JSON.stringify({ graphId: ID }) });
    assert.equal(started.status, 201);
    assert.deepEqual(calls.at(-1), ['t-1', ID, undefined, {}]);
    const signal = await request('/signals', { method: 'POST', body: '{"name":"ack","key":"C1"}' });
    assert.deepEqual(await signal.json(), { resumed: 3 });
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
