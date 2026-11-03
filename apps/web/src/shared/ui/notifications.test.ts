import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Notification } from '../notifications.ts';
import { idleLive } from '../testing.ts';
import { NotificationList, NotificationsButton, NotificationsPanel } from './notifications.tsx';

const note = (id: string, over: Partial<Notification> = {}): Notification => ({
  id,
  intent: 'success',
  title: `T${id}`,
  description: null,
  action: null,
  at: '2026-11-01T00:00:00Z',
  read: false,
  ...over
});

describe('NotificationList', () => {
  it('shows each message with when it happened and its link', () => {
    const html = renderToStaticMarkup(
      createElement(NotificationList, {
        items: [
          note('1', {
            description: 'Doe, Jane',
            action: { label: 'Open Claim', to: '/claims/c1' }
          }),
          note('2', { read: true, intent: 'danger' })
        ]
      })
    );
    assert.equal(html.match(/New: /g)?.length, 1);
    assert.equal(html.match(/bg-primary\/5/g)?.length, 1);
    assert.ok(html.includes('>Open Claim</a>'));
    assert.ok(html.includes('Doe, Jane') && html.includes('href="/claims/c1"'));
    assert.match(html, /datetime="2026-11-01T00:00:00Z"/i);
    assert.ok(
      renderToStaticMarkup(createElement(NotificationList, { items: [] })).includes('Nothing yet')
    );
  });
});

describe('NotificationsPanel', () => {
  it('puts a bell with the unread count beside the theme toggle', () => {
    const html = renderToStaticMarkup(
      createElement(NotificationsPanel, {
        items: [note('1')],
        unread: 12,
        onOpenChange: () => undefined,
        onClear: () => undefined
      })
    );
    assert.ok(html.includes('aria-label="Notifications (12 new)"'));
    assert.ok(html.includes('>9+<'));
    const [, target] = html.match(/popovertarget="(notifications-[^"]+)"/i) ?? [];
    assert.ok(target && html.includes(`id="${target}" popover="auto" role="dialog"`));
    assert.ok(html.includes('Clear All') && !html.includes('Nothing to clear.'));
  });

  it('shows a bare bell and blocks clearing an empty list', () => {
    const html = renderToStaticMarkup(
      createElement(NotificationsPanel, {
        items: [],
        unread: 0,
        onOpenChange: () => undefined,
        onClear: () => undefined
      })
    );
    assert.ok(html.includes('aria-label="Notifications"') && !html.includes(' new)'));
    assert.ok(!html.includes('tabular-nums'));
    assert.ok(html.includes('aria-disabled="true"') && html.includes('Nothing to clear.'));
  });

  it('loads the feed from the server', () => {
    const client = {
      list: () => new Promise<{ items: Notification[]; unread: number }>(() => undefined),
      record: async () => undefined,
      read: async () => undefined,
      clear: async () => undefined
    };
    const html = renderToStaticMarkup(
      createElement(NotificationsButton, { client, live: idleLive })
    );
    assert.ok(html.includes('aria-label="Notifications"'));
  });
});
