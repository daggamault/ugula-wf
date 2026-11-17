import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fail, ok, type Result } from '../../shared/result.ts';
import { withSession } from '../../shared/testing.ts';
import { createNotificationRoutes } from './routes.ts';
import type { NotificationService } from './service.ts';

const setup = (answer: Result<unknown> = ok({ status: 'ok' })) => {
  const calls: unknown[][] = [];
  const record =
    (name: string) =>
    async (...args: unknown[]) => {
      calls.push([name, ...args]);
      return answer;
    };
  const service = {
    list: record('list'),
    create: record('create'),
    read: record('read'),
    clear: record('clear')
  } as unknown as NotificationService;
  return { calls, request: withSession(createNotificationRoutes(service)) };
};

const post = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body) });

describe('notification routes', () => {
  it('lists the session user notifications in the agency', async () => {
    const { calls, request } = setup(ok({ items: [], unread: 0 }));
    const res = await request('/');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { items: [], unread: 0 });
    assert.deepEqual(calls, [['list', 't-1', 'u-1']]);
  });

  it('creates a message for the session user with defaults filled in', async () => {
    const { calls, request } = setup(ok({ id: 'n1' }));
    const res = await request(
      '/',
      post({ title: 'Fee saved', link: { label: 'Open', to: '/fees' } })
    );
    assert.equal(res.status, 201);
    assert.deepEqual(await res.json(), { id: 'n1' });
    assert.deepEqual(calls, [
      [
        'create',
        't-1',
        'u-1',
        {
          intent: 'success',
          title: 'Fee saved',
          description: null,
          link: { label: 'Open', to: '/fees' }
        }
      ]
    ]);
  });

  it('marks the feed read and clears it', async () => {
    const { calls, request } = setup();
    const read = await request('/read', { method: 'POST' });
    assert.equal(read.status, 200);
    assert.deepEqual(await read.json(), { status: 'ok' });
    assert.equal((await request('/clear', { method: 'POST' })).status, 200);
    assert.deepEqual(calls, [
      ['read', 't-1', 'u-1'],
      ['clear', 't-1', 'u-1']
    ]);
  });

  it('rejects links that leave the app without calling the service', async () => {
    const { calls, request } = setup();
    const res = await request(
      '/',
      post({ title: 'x', link: { label: 'x', to: 'https://evil.test' } })
    );
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), {
      error: 'link.to: Links stay inside the app',
      issues: ['link.to: Links stay inside the app']
    });
    assert.deepEqual(calls, []);
  });

  it('rejects messages without a title without calling the service', async () => {
    const { calls, request } = setup();
    const blank = await request('/', post({ title: ' ' }));
    assert.equal(blank.status, 400);
    assert.deepEqual(await blank.json(), {
      error: 'title: Invalid length: Expected !0 but received 0',
      issues: ['title: Invalid length: Expected !0 but received 0']
    });
    assert.equal((await request('/', post({}))).status, 400);
    assert.deepEqual(calls, []);
  });

  it('answers a service failure with its status and message', async () => {
    const { request } = setup(fail('forbidden', 'Not your agency'));
    const res = await request('/');
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: 'Not your agency' });
  });

  it('refuses requests without a session', async () => {
    const { calls, request } = setup();
    const res = await request('/', { headers: { cookie: '' } });
    assert.equal(res.status, 401);
    assert.deepEqual(calls, []);
  });
});
