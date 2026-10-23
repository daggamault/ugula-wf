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
  list: record({ tasks: [] }),
  find: record({ task: { id: ID } }),
  next: record({ task: null }),
  claim: record({ status: 'claimed' }),
  release: async () => fail('conflict', 'Task is already closed'),
  complete: async () => fail('invalid', 'Some fields are invalid', { fields: { note: 'x' } })
} as unknown as TaskService;

const request = withSession(createTaskRoutes(service));

describe('task routes', () => {
  it('list my tasks in a queue', async () => {
    await request('/?mine=true&queue=billing');
    assert.deepEqual(calls.at(-1), [
      't-1',
      {
        queue: 'billing',
        assigneeId: 'u-1',
        status: 'open',
        page: 1,
        pageSize: 25,
        sort: 'waiting',
        dir: 'desc'
      }
    ]);
    assert.equal((await request('/queues')).status, 200);
  });

  it('hand out work and claim tasks as the session user', async () => {
    await request('/next', { method: 'POST', body: '{"queue":"billing"}' });
    assert.deepEqual(calls.at(-1), ['t-1', 'billing', 'u-1']);
    await request(`/${ID}/claim`, { method: 'POST' });
    assert.deepEqual(calls.at(-1), ['t-1', ID, 'u-1']);
    assert.equal((await request(`/${ID}/release`, { method: 'POST' })).status, 409);
  });

  it('surface field errors when completing', async () => {
    const body = JSON.stringify({ outcome: 'approve', values: { note: 1 } });
    const res = await request(`/${ID}/complete`, { method: 'POST', body });
    assert.equal(res.status, 422);
    assert.deepEqual(await res.json(), { error: 'Some fields are invalid', fields: { note: 'x' } });
    assert.equal((await request(`/${ID}`)).status, 200);
  });
});
