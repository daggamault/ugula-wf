import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApi } from './api.ts';
import { createNotificationsClient, type Notification } from './notifications.ts';

const saved: Notification = {
  id: 'n1',
  intent: 'success',
  title: 'Saved',
  description: null,
  action: null,
  at: '2026-11-17T10:00:00.000Z',
  read: false
};

const fakeNotifications = () => {
  const calls: string[] = [];
  const client = createNotificationsClient(
    createApi(
      '',
      async (url, init = {}) => {
        calls.push(`${init.method} ${String(url)} ${String(init.body ?? '')}`.trim());
        return new Response(JSON.stringify({ items: [saved], unread: 1 }), { status: 200 });
      },
      () => undefined,
      () => null
    )
  );
  return { calls, client };
};

describe('createNotificationsClient', () => {
  it('reads the feed with its unread count', async () => {
    const { calls, client } = fakeNotifications();
    assert.deepEqual(await client.list(), { items: [saved], unread: 1 });
    assert.deepEqual(calls, ['GET /api/notifications']);
  });

  it('records a message as a success without a description or link by default', async () => {
    const { calls, client } = fakeNotifications();
    await client.record({ title: 'Saved' });
    assert.deepEqual(calls, [
      'POST /api/notifications {"intent":"success","title":"Saved","description":null,"link":null}'
    ]);
  });

  it('records the intent, description and action it is given, sending the action as the link', async () => {
    const { calls, client } = fakeNotifications();
    await client.record({
      intent: 'danger',
      title: 'Import failed',
      description: 'Row 3 has no date',
      action: { label: 'Open', to: '/imports' }
    });
    assert.deepEqual(calls, [
      'POST /api/notifications {"intent":"danger","title":"Import failed","description":"Row 3 has no date","link":{"label":"Open","to":"/imports"}}'
    ]);
  });

  it('marks the feed read and clears it', async () => {
    const { calls, client } = fakeNotifications();
    await client.read();
    await client.clear();
    assert.deepEqual(calls, ['POST /api/notifications/read', 'POST /api/notifications/clear']);
  });
});
