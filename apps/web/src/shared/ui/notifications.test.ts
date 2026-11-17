import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { createElement } from 'react';
import { formatDateTime } from '../format.ts';
import type { Live } from '../live.ts';
import type { Notification, NotificationsClient } from '../notifications.ts';
import { idleLive } from '../testing.ts';
import { act, render, screen, userEvent, waitFor, within } from '../testing-dom.ts';
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

const showPanel = (items: Notification[], unread: number) => {
  const opened: boolean[] = [];
  const cleared: number[] = [];
  render(
    createElement(NotificationsPanel, {
      items,
      unread,
      onOpenChange: (open) => opened.push(open),
      onClear: () => cleared.push(1)
    })
  );
  return { opened, cleared, user: userEvent.setup() };
};

describe('NotificationList', () => {
  it('marks only unread messages as new to screen readers', () => {
    render(
      createElement(NotificationList, {
        items: [note('1'), note('2', { read: true, intent: 'danger' })]
      })
    );
    assert.deepEqual(
      screen.getAllByRole('listitem').map((li) => li.querySelector('p')?.textContent),
      ['New: T1', 'T2']
    );
  });

  it('shows the description, when it happened and the link to follow', () => {
    render(
      createElement(NotificationList, {
        items: [
          note('1', { description: 'Doe, Jane', action: { label: 'Open Claim', to: '/claims/c1' } })
        ]
      })
    );
    const item = screen.getByRole('listitem');
    assert.equal(within(item).getByText('Doe, Jane').tagName, 'P');
    const time = item.querySelector('time');
    assert.equal(time?.getAttribute('datetime'), '2026-11-01T00:00:00Z');
    assert.equal(time?.getAttribute('title'), formatDateTime('2026-11-01T00:00:00Z'));
    assert.equal(
      within(item).getByRole('link', { name: 'Open Claim' }).getAttribute('href'),
      '/claims/c1'
    );
  });

  it('leaves out the description and link when a message has neither', () => {
    render(createElement(NotificationList, { items: [note('1')] }));
    const item = screen.getByRole('listitem');
    assert.equal(item.querySelectorAll('p').length, 2);
    assert.ok(!within(item).queryByRole('link'));
  });

  it('navigates in place and tells the caller when a link is followed', async () => {
    const follows: number[] = [];
    render(
      createElement(NotificationList, {
        items: [note('1', { action: { label: 'Open Claim', to: '/claims/c1' } })],
        onFollow: () => follows.push(1)
      })
    );
    await userEvent.setup().click(screen.getByRole('link', { name: 'Open Claim' }));
    assert.deepEqual(follows, [1]);
    assert.equal(window.location.pathname, '/claims/c1');
  });

  it('explains what will appear when there is nothing yet', () => {
    render(createElement(NotificationList, { items: [] }));
    assert.ok(!screen.queryByRole('list'));
    assert.equal(
      screen.getByText(/^Nothing yet\./).textContent,
      'Nothing yet. New tasks, stuck runs and messages from your work are kept here.'
    );
  });
});

const badgeOf = (bell: HTMLElement) => {
  const badge = bell.parentElement?.nextElementSibling;
  return badge?.tagName === 'SPAN' ? badge : null;
};

describe('NotificationsPanel', () => {
  it('names the bell by the unread count and caps the badge at 9+', () => {
    showPanel([note('1')], 12);
    const bell = screen.getByRole('button', { name: 'Notifications (12 new)' });
    assert.equal(badgeOf(bell)?.textContent, '9+');
    assert.equal(badgeOf(bell)?.getAttribute('aria-hidden'), 'true');
  });

  it('shows the exact unread count up to nine', () => {
    showPanel([note('1')], 3);
    const bell = screen.getByRole('button', { name: 'Notifications (3 new)' });
    assert.equal(badgeOf(bell)?.textContent, '3');
  });

  it('shows a bare bell with no badge when nothing is unread', () => {
    showPanel([], 0);
    const bell = screen.getByRole('button', { name: 'Notifications' });
    assert.equal(badgeOf(bell), null);
  });

  it('opens a labelled dialog from the bell', () => {
    showPanel([note('1')], 1);
    const bell = screen.getByRole('button', { name: 'Notifications (1 new)' });
    const dialog = screen.getByRole('dialog', { name: 'Notifications' });
    assert.equal(bell.getAttribute('popovertarget'), dialog.id);
    assert.equal(dialog.getAttribute('popover'), 'auto');
    assert.equal(within(dialog).getByRole('heading', { level: 2 }).textContent, 'Notifications');
  });

  it('reports the panel opening and closing', () => {
    const { opened } = showPanel([note('1')], 1);
    const dialog = screen.getByRole('dialog', { name: 'Notifications' });
    act(() => dialog.showPopover());
    act(() => dialog.hidePopover());
    assert.deepEqual(opened, [true, false]);
  });

  it('clears the list on request', async () => {
    const { cleared, user } = showPanel([note('1')], 1);
    const clear = screen.getByRole('button', { name: 'Clear All' });
    assert.equal(clear.getAttribute('aria-disabled'), null);
    await user.click(clear);
    assert.deepEqual(cleared, [1]);
  });

  it('blocks clearing an empty list and says why', async () => {
    const { cleared, user } = showPanel([], 0);
    const clear = screen.getByRole('button', { name: 'Clear All' });
    assert.equal(clear.getAttribute('aria-disabled'), 'true');
    assert.equal(
      document.getElementById(clear.getAttribute('aria-describedby') ?? '')?.textContent,
      'Nothing to clear.'
    );
    await user.click(clear);
    assert.deepEqual(cleared, []);
  });

  it('closes the panel when a link inside is followed', async () => {
    const { opened, user } = showPanel(
      [note('1', { action: { label: 'Open Claim', to: '/claims/c1' } })],
      1
    );
    const dialog = screen.getByRole('dialog', { name: 'Notifications' });
    act(() => dialog.showPopover());
    await user.click(within(dialog).getByRole('link', { name: 'Open Claim' }));
    assert.deepEqual(opened, [true, false]);
    assert.equal(dialog.matches(':popover-open'), false);
  });
});

describe('NotificationsButton', () => {
  const fakeClient = (feeds: { items: Notification[]; unread: number }[]) => {
    const calls: string[] = [];
    const client: NotificationsClient = {
      list: async () => {
        calls.push('list');
        const loads = calls.filter((c) => c === 'list').length;
        return feeds[Math.min(loads, feeds.length) - 1] ?? { items: [], unread: 0 };
      },
      record: async () => {
        calls.push('record');
      },
      read: async () => {
        calls.push('read');
      },
      clear: async () => {
        calls.push('clear');
      }
    } as unknown as NotificationsClient;
    return { client, calls };
  };

  it('shows a bare bell while the feed loads', () => {
    const client = {
      list: () => new Promise<never>(() => undefined)
    } as unknown as NotificationsClient;
    render(createElement(NotificationsButton, { client, live: idleLive }));
    assert.equal(screen.getByRole('button', { name: 'Notifications' }).tagName, 'BUTTON');
  });

  it('shows the loaded feed and its unread count', async () => {
    const { client } = fakeClient([{ items: [note('1'), note('2')], unread: 2 }]);
    render(createElement(NotificationsButton, { client, live: idleLive }));
    await screen.findByRole('button', { name: 'Notifications (2 new)' });
    assert.equal(screen.getAllByRole('listitem').length, 2);
  });

  it('marks everything read when the panel closes with unread messages, then reloads', async () => {
    const { client, calls } = fakeClient([
      { items: [note('1')], unread: 1 },
      { items: [note('1', { read: true })], unread: 0 }
    ]);
    render(createElement(NotificationsButton, { client, live: idleLive }));
    await screen.findByRole('button', { name: 'Notifications (1 new)' });
    const dialog = screen.getByRole('dialog', { name: 'Notifications' });
    act(() => dialog.showPopover());
    act(() => dialog.hidePopover());
    await screen.findByRole('button', { name: 'Notifications' });
    assert.deepEqual(calls, ['list', 'read', 'list']);
  });

  it('leaves the feed alone when the panel closes with nothing unread', async () => {
    const { client, calls } = fakeClient([{ items: [note('1', { read: true })], unread: 0 }]);
    render(createElement(NotificationsButton, { client, live: idleLive }));
    await waitFor(() => assert.equal(screen.getAllByRole('listitem').length, 1));
    const dialog = screen.getByRole('dialog', { name: 'Notifications' });
    act(() => dialog.showPopover());
    act(() => dialog.hidePopover());
    assert.deepEqual(calls, ['list']);
  });

  it('clears the feed on request, then reloads', async () => {
    const { client, calls } = fakeClient([
      { items: [note('1')], unread: 1 },
      { items: [], unread: 0 }
    ]);
    render(createElement(NotificationsButton, { client, live: idleLive }));
    await screen.findByRole('button', { name: 'Notifications (1 new)' });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Clear All' }));
    await waitFor(() => assert.equal(screen.queryAllByRole('listitem').length, 0));
    assert.deepEqual(calls, ['list', 'clear', 'list']);
  });

  it('reloads when a notification or task event arrives, and ignores others', async () => {
    let send: Parameters<Live['subscribe']>[0] = () => undefined;
    const live: Live = {
      ...idleLive,
      subscribe: (listener) => {
        send = listener;
        return () => undefined;
      }
    };
    const { client, calls } = fakeClient([{ items: [], unread: 0 }]);
    render(createElement(NotificationsButton, { client, live }));
    await waitFor(() => assert.deepEqual(calls, ['list']));
    send({ kind: 'claim', id: 'c1' });
    await act(() => sleep(300));
    assert.deepEqual(calls, ['list']);
    send({ kind: 'notification', id: 'n1' });
    await waitFor(() => assert.deepEqual(calls, ['list', 'list']));
    send({ kind: 'task', id: 't1', runId: null });
    await waitFor(() => assert.deepEqual(calls, ['list', 'list', 'list']));
  });
});
