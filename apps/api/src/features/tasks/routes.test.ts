import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PERMISSIONS } from '@ugula/access';
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
  search: record({ items: [], total: 0, page: 1, pageSize: 25 }),
  queues: record({ queues: [] }),
  find: async (...args: unknown[]) => {
    calls.push(args);
    return args[1] === ID ? ok({ task: { id: ID } }) : fail('not_found', 'Task not found');
  },
  next: record({ task: null }),
  claim: record({ status: 'claimed' }),
  release: async (...args: unknown[]) => {
    calls.push(args);
    return fail('conflict', 'Another user is working this task');
  },
  complete: async () => fail('invalid', 'Some fields are invalid', { fields: { note: 'x' } }),
  uploadFile: async (...args: unknown[]) => {
    calls.push(args);
    return ok({ file: { bucket: 'b', key: 'k' }, name: 'pcs.pdf' });
  },
  maxBytes: 1_000
} as unknown as TaskService;

const request = withSession(createTaskRoutes(service));

describe('task routes', () => {
  it('summarize queues for the session user', async () => {
    const res = await request('/queues');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { queues: [] });
    assert.deepEqual(calls.at(-1), ['t-1', 'u-1']);
  });

  it('list open tasks for the session user with defaults', async () => {
    const res = await request('/');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { items: [], total: 0, page: 1, pageSize: 25 });
    assert.deepEqual(calls.at(-1), [
      't-1',
      { queue: [], assignee: [], page: 1, pageSize: 25, sort: 'waiting', dir: 'asc' }
    ]);
  });

  it('pass queue, assignee, search and paging filters through', async () => {
    await request(
      `/?q=%20Doe%20&queue=billing,coding&assignee=${ID},none&page=2&pageSize=50&sort=due&dir=desc`
    );
    assert.deepEqual(calls.at(-1), [
      't-1',
      {
        queue: ['billing', 'coding'],
        assignee: [ID, 'none'],
        page: 2,
        pageSize: 50,
        sort: 'due',
        dir: 'desc',
        q: 'Doe'
      }
    ]);
    await request(`/?runId=${ID}`);
    assert.deepEqual(calls.at(-1), [
      't-1',
      { queue: [], assignee: [], runId: ID, page: 1, pageSize: 25, sort: 'waiting', dir: 'asc' }
    ]);
    assert.equal((await request('/?runId=nope')).status, 400);
    await request('/?q=%20%20&assignee=none');
    assert.deepEqual(calls.at(-1), [
      't-1',
      { queue: [], assignee: ['none'], page: 1, pageSize: 25, sort: 'waiting', dir: 'asc' }
    ]);
  });

  it('hand out work and claim tasks as the session user', async () => {
    await request('/next', { method: 'POST', body: '{"queue":"billing"}' });
    assert.deepEqual(calls.at(-1), ['t-1', 'billing', 'u-1', [...PERMISSIONS]]);
    await request('/next', { method: 'POST', body: '{}' });
    assert.deepEqual(calls.at(-1), ['t-1', null, 'u-1', [...PERMISSIONS]]);
    await request(`/${ID}/claim`, { method: 'POST' });
    assert.deepEqual(calls.at(-1), ['t-1', ID, 'u-1', [...PERMISSIONS]]);
    assert.equal((await request(`/${ID}/release`, { method: 'POST' })).status, 409);
    assert.deepEqual(calls.at(-1), ['t-1', ID, 'u-1']);
  });

  it('take a file for a task as the session user, up to the size limit', async () => {
    const form = new FormData();
    form.set('file', new File(['%PDF-1.7'], 'pcs.pdf', { type: 'application/pdf' }));
    const res = await request(`/${ID}/files`, { method: 'POST', body: form });
    assert.equal(res.status, 201);
    assert.deepEqual(await res.json(), { file: { bucket: 'b', key: 'k' }, name: 'pcs.pdf' });
    const [agency, id, user, file] = calls.at(-1) as [string, string, string, { name: string }];
    assert.deepEqual([agency, id, user, file.name], ['t-1', ID, 'u-1', 'pcs.pdf']);
    const big = new FormData();
    big.set('file', new File(['x'.repeat(70_000)], 'big.pdf'));
    assert.equal((await request(`/${ID}/files`, { method: 'POST', body: big })).status, 413);
    assert.equal(
      (await request(`/${ID}/files`, { method: 'POST', body: new FormData() })).status,
      400
    );
  });

  it('surface field errors when completing', async () => {
    const body = JSON.stringify({ outcome: 'approve', values: { note: 1 } });
    const res = await request(`/${ID}/complete`, { method: 'POST', body });
    assert.equal(res.status, 422);
    assert.deepEqual(await res.json(), { error: 'Some fields are invalid', fields: { note: 'x' } });
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
      await request('/nope/complete', { method: 'POST', body: '{"outcome":"ok"}' }),
      await request('/?assignee=mine'),
      await request(`/?queue=${'q'.repeat(61)}`),
      await request('/?sort=nope'),
      await request('/?pageSize=7'),
      await request(`/?q=${'x'.repeat(81)}`)
    ];
    assert.deepEqual(
      bad.map((r) => r.status),
      bad.map(() => 400)
    );
    assert.equal(calls.length, count);
  });

  it('open a task in the session agency, or 404 when it has none by that id', async () => {
    const found = await request(`/${ID}`);
    assert.deepEqual([found.status, await found.json()], [200, { task: { id: ID } }]);
    assert.deepEqual(calls.at(-1), ['t-1', ID]);
    const other = '01a16617-7704-7ba6-b9b5-9c79fa44f966';
    const missing = await request(`/${other}`);
    assert.deepEqual([missing.status, await missing.json()], [404, { error: 'Task not found' }]);
  });
});
