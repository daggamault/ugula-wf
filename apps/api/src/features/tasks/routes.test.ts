import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fail, ok } from '../../shared/result.ts';
import { withSession } from '../../shared/testing.ts';
import { createTaskRoutes } from './routes.ts';
import type { TaskService } from './service.ts';

const ID = '01a16617-7704-7ba6-b9b5-9c79fa44f965';

const calls: unknown[][] = [];
const record =
  (value: unknown) =>
  async (...args: unknown[]) => {
    calls.push(args);
    return ok(value);
  };

const service = {
  queues: record({ queues: [] }),
  find: record({ task: { id: ID } }),
  next: record({ task: null }),
  claim: record({ status: 'claimed' }),
  release: async (...args: unknown[]) => {
    calls.push(args);
    return fail('conflict', 'Another user is working this task');
  },
  complete: async () => fail('invalid', 'Some fields are invalid', { fields: { note: 'x' } })
} as unknown as TaskService;

const request = withSession(createTaskRoutes(service));

describe('task routes', () => {
  it('summarize queues for the session user', async () => {
    assert.equal((await request('/queues')).status, 200);
    assert.deepEqual(calls.at(-1), ['t-1', 'u-1']);
    assert.equal((await request('/')).status, 404);
  });

  it('hand out work and claim tasks as the session user', async () => {
    await request('/next', { method: 'POST', body: '{"queue":"billing"}' });
    assert.deepEqual(calls.at(-1), ['t-1', 'billing', 'u-1']);
    await request('/next', { method: 'POST', body: '{}' });
    assert.deepEqual(calls.at(-1), ['t-1', null, 'u-1']);
    await request(`/${ID}/claim`, { method: 'POST' });
    assert.deepEqual(calls.at(-1), ['t-1', ID, 'u-1']);
    assert.equal((await request(`/${ID}/release`, { method: 'POST' })).status, 409);
    assert.deepEqual(calls.at(-1), ['t-1', ID, 'u-1']);
  });

  it('surface field errors when completing', async () => {
    const body = JSON.stringify({ outcome: 'approve', values: { note: 1 } });
    const res = await request(`/${ID}/complete`, { method: 'POST', body });
    assert.equal(res.status, 422);
    assert.deepEqual(await res.json(), { error: 'Some fields are invalid', fields: { note: 'x' } });
    assert.equal((await request(`/${ID}`)).status, 200);
  });
});

describe('task route validation', () => {
  it('reject bad ids, queues and outcomes before reaching the service', async () => {
    const count = calls.length;
    const bad = [
      await request('/nope'),
      await request('/nope/claim', { method: 'POST' }),
      await request('/nope/release', { method: 'POST' }),
      await request('/next', { method: 'POST', body: '{"queue":""}' }),
      await request(`/${ID}/complete`, { method: 'POST', body: '{"outcome":""}' }),
      await request(`/${ID}/complete`, { method: 'POST', body: '{}' }),
      await request('/nope/complete', { method: 'POST', body: '{"outcome":"ok"}' })
    ];
    assert.deepEqual(
      bad.map((r) => r.status),
      bad.map(() => 400)
    );
    assert.equal(calls.length, count);
  });

  it('open a task in the session agency', async () => {
    await request(`/${ID}`);
    assert.deepEqual(calls.at(-1), ['t-1', ID]);
  });
});
