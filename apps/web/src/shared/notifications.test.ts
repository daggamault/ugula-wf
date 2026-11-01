import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApi } from './api.ts';
import { createNotificationsClient } from './notifications.ts';

describe('createNotificationsClient', () => {
  it('reads the feed and records, reads and clears messages', async () => {
    const seen: string[] = [];
    const client = createNotificationsClient(
      createApi('', async (url, init = {}) => {
        seen.push(`${init.method} ${String(url)} ${String(init.body ?? '')}`.trim());
        return new Response('{"items":[],"unread":0}', { status: 200 });
      })
    );
    assert.deepEqual(await client.list(), { items: [], unread: 0 });
    await client.record({ title: 'Saved', action: { label: 'Open', to: '/fees' } });
    await client.read();
    await client.clear();
    assert.deepEqual(seen, [
      'GET /api/notifications',
      'POST /api/notifications {"intent":"success","title":"Saved","description":null,"link":{"label":"Open","to":"/fees"}}',
      'POST /api/notifications/read',
      'POST /api/notifications/clear'
    ]);
  });
});
