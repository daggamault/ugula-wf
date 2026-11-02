import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import * as v from 'valibot';
import { recordAnnouncements, withSession } from '../../shared/testing.ts';
import { insertNotification, listNotifications, markState } from './queries.ts';
import { createNotificationRoutes } from './routes.ts';
import { notificationSchema } from './schemas.ts';
import { createNotificationService, toNotification } from './service.ts';

describe('notification queries', () => {
  it('list the tenant feed and the user own messages since they last cleared', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await listNotifications(db, 't', 'u');
    const [list] = queries;
    assert.ok(list?.sql.includes('("n"."user_id" is null or "n"."user_id" = $'));
    assert.ok(list?.sql.includes('s.cleared_at is null or n.created_at > s.cleared_at'));
    assert.ok(list?.sql.includes('limit $'));
    await db.destroy();
  });

  it('record personal messages and read or cleared marks per user', async () => {
    const { db, queries } = createRecordingDb(() => [{ id: 'n1' }]);
    await insertNotification(db, 't', 'u', {
      intent: 'success',
      title: 'Fee saved',
      description: null,
      link: { label: 'Open', to: '/fees' }
    });
    await markState(db, 'u', false);
    await markState(db, 'u', true);
    assert.deepEqual(queries[0]?.parameters.slice(0, 7), [
      't',
      'u',
      'success',
      'Fee saved',
      null,
      'Open',
      '/fees'
    ]);
    assert.ok(queries[1]?.sql.includes('on conflict ("user_id") do update set "read_at" = now()'));
    assert.ok(!queries[1]?.sql.includes('"cleared_at" = now()'));
    assert.ok(queries[2]?.sql.includes('"cleared_at" = now()'));
    await db.destroy();
  });
});

describe('notification service and routes', () => {
  it('shapes rows with their link and read state', () => {
    assert.deepEqual(
      toNotification({
        id: 'n1',
        intent: 'info',
        title: 'New task',
        description: 'PCR-1',
        link_label: 'Open task',
        link_to: '/tasks/k1',
        created_at: new Date('2026-11-01T00:00:00Z'),
        read: false
      }),
      {
        id: 'n1',
        intent: 'info',
        title: 'New task',
        description: 'PCR-1',
        action: { label: 'Open task', to: '/tasks/k1' },
        at: '2026-11-01T00:00:00.000Z',
        read: false
      }
    );
  });

  it('serves the session user and tells their other devices', async () => {
    const { db } = createRecordingDb(() => [
      { id: 'n1', created_at: new Date('2026-11-01T00:00:00Z'), read: true }
    ]);
    const { announce, events } = recordAnnouncements();
    const request = withSession(
      createNotificationRoutes(createNotificationService({ db, announce }))
    );
    const list = await request('/');
    assert.equal(list.status, 200);
    assert.equal(((await list.json()) as { unread: number }).unread, 0);
    const body = JSON.stringify({ title: 'Fee saved', link: { label: 'Open', to: '/fees' } });
    assert.equal((await request('/', { method: 'POST', body })).status, 201);
    assert.equal((await request('/read', { method: 'POST' })).status, 200);
    assert.equal((await request('/clear', { method: 'POST' })).status, 200);
    assert.equal(events.length, 3);
    assert.deepEqual(events[0], { tenantId: 't-1', event: { kind: 'notification', id: null } });
    const outside = JSON.stringify({ title: 'x', link: { label: 'x', to: 'https://evil.test' } });
    assert.equal((await request('/', { method: 'POST', body: outside })).status, 400);
    await db.destroy();
  });

  it('defaults messages to a success without a link', () => {
    assert.deepEqual(v.parse(notificationSchema, { title: ' Saved ' }), {
      intent: 'success',
      title: 'Saved',
      description: null,
      link: null
    });
  });
});
