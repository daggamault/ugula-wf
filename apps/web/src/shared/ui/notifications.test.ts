import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NotificationList, NotificationsButton, unreadCount } from './notifications.tsx';
import {
  NOTIFICATION_LIMIT,
  type Notification,
  readNotifications,
  recordNotification,
  ToastProvider
} from './toast.tsx';

const note = (id: string, over: Partial<Notification> = {}): Notification => ({
  id,
  title: `T${id}`,
  at: '2026-11-01T00:00:00Z',
  read: false,
  ...over
});

describe('notification log', () => {
  it('keeps the newest first, replaces repeats and caps the list', () => {
    const list = ['1', '2', '3'].map((id) => note(id)).reduce(recordNotification, []);
    assert.deepEqual(
      list.map((n) => n.id),
      ['3', '2', '1']
    );
    const repeated = recordNotification(list, note('4', { title: 'T1' }));
    assert.deepEqual(
      repeated.map((n) => n.id),
      ['4', '3', '2']
    );
    const many = Array.from({ length: NOTIFICATION_LIMIT + 5 }, (_, i) => note(String(i)));
    assert.equal(many.reduce(recordNotification, []).length, NOTIFICATION_LIMIT);
    assert.equal(unreadCount([note('a'), note('b', { read: true })]), 1);
  });

  it('reads stored notifications and ignores anything malformed', () => {
    assert.deepEqual(readNotifications(JSON.stringify([note('1'), { id: 2 }, null])), [note('1')]);
    assert.deepEqual(readNotifications('{oops'), []);
    assert.deepEqual(readNotifications(null), []);
  });
});

describe('NotificationList', () => {
  it('shows each message with when it happened and its link', () => {
    const html = renderToStaticMarkup(
      createElement(NotificationList, {
        items: [
          note('1', {
            description: 'Doe, Jane',
            action: { label: 'Open claim', to: '/claims/c1' }
          }),
          note('2', { read: true, intent: 'danger' })
        ]
      })
    );
    assert.equal(html.match(/New: /g)?.length, 1);
    assert.ok(html.includes('Doe, Jane') && html.includes('href="/claims/c1"'));
    assert.ok(/datetime="2026-11-01T00:00:00Z"/i.test(html));
    assert.ok(
      renderToStaticMarkup(createElement(NotificationList, { items: [] })).includes('Nothing yet')
    );
  });

  it('puts a bell beside the theme toggle that opens the history', () => {
    const html = renderToStaticMarkup(
      createElement(ToastProvider, null, createElement(NotificationsButton))
    );
    assert.ok(html.includes('aria-label="Notifications"'));
    assert.ok(/popovertarget="notifications-/i.test(html));
    assert.ok(html.includes('Clear all'));
  });
});
