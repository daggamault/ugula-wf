import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ok } from '../../shared/result.ts';
import { withSession } from '../../shared/testing.ts';
import { createNotificationRoutes } from './routes.ts';
import type { NotificationService } from './service.ts';

const calls: unknown[][] = [];

const record =
  (name: string, value: unknown) =>
  async (...args: unknown[]) => {
    calls.push([name, ...args]);
    return ok(value);
  };

const service = {
  list: record('list', { items: [], unread: 0 }),
  create: record('create', { status: 'ok' }),
  read: record('read', { status: 'ok' }),
  clear: record('clear', { status: 'ok' })
} as unknown as NotificationService;

const request = withSession(createNotificationRoutes(service));

describe('notification routes', () => {
  it('serve and update the session user notifications', async () => {
    const list = await request('/');
    assert.equal(list.status, 200);
    assert.deepEqual(await list.json(), { items: [], unread: 0 });
    const body = JSON.stringify({ title: 'Fee saved', link: { label: 'Open', to: '/fees' } });
    assert.equal((await request('/', { method: 'POST', body })).status, 201);
    assert.equal((await request('/read', { method: 'POST' })).status, 200);
    assert.equal((await request('/clear', { method: 'POST' })).status, 200);
    assert.deepEqual(calls, [
      ['list', 't-1', 'u-1'],
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
      ],
      ['read', 't-1', 'u-1'],
      ['clear', 't-1', 'u-1']
    ]);
  });

  it('rejects links that leave the app', async () => {
    const body = JSON.stringify({ title: 'x', link: { label: 'x', to: 'https://evil.test' } });
    assert.equal((await request('/', { method: 'POST', body })).status, 400);
  });

  it('rejects messages without a title and leaves the service alone', async () => {
    const before = calls.length;
    const res = await request('/', { method: 'POST', body: JSON.stringify({ title: ' ' }) });
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as { error: string }).error, /^title: /);
    assert.equal((await request('/', { method: 'POST', body: '{}' })).status, 400);
    assert.equal(calls.length, before);
  });
});
