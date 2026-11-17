import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Permission } from '@ugula/access';
import { createElement } from 'react';
import { type Access, AccessProvider } from '../../shared/access.tsx';
import { formatDateTime } from '../../shared/format.ts';
import { idleLive } from '../../shared/testing.ts';
import { render, screen, userEvent, waitFor, within } from '../../shared/testing-dom.ts';
import { type ToastInput, ToastProvider } from '../../shared/ui/toast.tsx';
import type { Page } from '../../shared/url-state.ts';
import type { AgencyUser, Invitation, UsersClient } from './client.ts';
import { UsersPage, type UsersTab } from './users-page.tsx';

const person = (patch: Partial<AgencyUser>): AgencyUser => ({
  id: 'u1',
  email: 'ann@example.com',
  firstName: 'Ann',
  lastName: 'Lee',
  isOwner: false,
  version: 1,
  role: { id: 'r1', name: 'Biller' },
  blockedReason: null,
  ...patch
});

const invitation = (patch: Partial<Invitation>): Invitation => ({
  id: 'i1',
  email: 'bo@example.com',
  firstName: 'Bo',
  lastName: 'Ray',
  role: { id: 'r1', name: 'Biller' },
  isGrantable: true,
  isExpired: false,
  expiresAt: '2026-01-08T00:00:00Z',
  createdAt: '2026-01-01T00:00:00Z',
  ...patch
});

const users = [
  person({}),
  person({ id: 'u2', firstName: 'Me', email: 'me@example.com', blockedReason: 'self' }),
  person({
    id: 'u3',
    firstName: 'Boss',
    email: 'boss@example.com',
    isOwner: true,
    role: { id: 'r2', name: 'Admin' },
    blockedReason: 'outranked'
  })
];

const invitations = [
  invitation({}),
  invitation({ id: 'i2', firstName: 'Al', email: 'al@example.com', isGrantable: false }),
  invitation({ id: 'i3', firstName: 'Cy', email: 'cy@example.com', isExpired: true })
];

const pageOf = <T>(items: T[]): Page<T> => ({ items, total: items.length, page: 1, pageSize: 25 });

const ALL: Permission[] = ['users:read', 'users:create', 'users:update', 'users:delete'];

const access = (permissions: Permission[]): Access => ({
  agencyId: 'a1',
  agencyName: 'North EMS',
  organizationId: 'o1',
  organizationName: 'Acme',
  userId: 'u0',
  isOrganizationAdmin: false,
  permissions
});

const fakeClient = (over: Partial<UsersClient> = {}) => {
  const searched: string[] = [];
  const listed: string[] = [];
  const resent: string[] = [];
  const removed: string[] = [];
  const client = {
    search: async (query: string) => {
      searched.push(query);
      return pageOf(users);
    },
    invitations: async (query: string) => {
      listed.push(query);
      return pageOf(invitations);
    },
    resend: async (id: string) => {
      resent.push(id);
      return { id, link: 'http://app.test/invitation?token=t2' };
    },
    removeInvitation: async (id: string) => {
      removed.push(id);
      return { id };
    },
    ...over
  } as UsersClient;
  return { client, searched, listed, resent, removed };
};

const show = (client: UsersClient, tab: UsersTab = 'users', permissions: Permission[] = ALL) => {
  window.history.replaceState(null, '', tab === 'users' ? '/users' : '/users/invitations');
  const toasts: ToastInput[] = [];
  render(
    createElement(AccessProvider, {
      access: access(permissions),
      children: createElement(
        ToastProvider,
        { onNotify: (t) => toasts.push(t) },
        createElement(UsersPage, { client, live: idleLive, tab })
      )
    })
  );
  return { toasts, user: userEvent.setup() };
};

const rowsOf = async (name: string) =>
  within(await screen.findByRole('table', { name }))
    .getAllByRole('row')
    .slice(1)
    .map((r) =>
      within(r)
        .getAllByRole('cell')
        .slice(0, -1)
        .map((c) => c.lastElementChild?.textContent)
    );

const button = (name: string) => screen.getByRole('button', { name });

const href = (name: string) => screen.getByRole('link', { name }).getAttribute('href');

describe('UsersPage users tab', () => {
  it('lists users with their email, role and badges', async () => {
    const { client, searched } = fakeClient();
    show(client);
    assert.deepEqual(await rowsOf('Users'), [
      ['Ann Lee', 'ann@example.com', 'Biller'],
      ['Me LeeYou', 'me@example.com', 'Biller'],
      ['Boss LeeOwner', 'boss@example.com', 'Admin']
    ]);
    assert.deepEqual(searched, ['page=1&pageSize=25&sort=name&dir=asc']);
    assert.equal(
      screen.getByRole('link', { name: 'Users', current: 'page' }).getAttribute('href'),
      '/users'
    );
  });

  it('edits only users that can be changed and opens the rest', async () => {
    const { client } = fakeClient();
    show(client);
    await rowsOf('Users');
    assert.equal(href('Edit Ann Lee'), '/users/u1');
    assert.equal(href('Open Me Lee'), '/users/u2');
    assert.equal(href('Open Boss Lee'), '/users/u3');
    assert.ok(!screen.queryByRole('link', { name: 'Edit Me Lee' }));
    assert.ok(!screen.queryByRole('link', { name: 'Edit Boss Lee' }));
  });

  it('opens rather than edits users without the update permission', async () => {
    const { client } = fakeClient();
    show(client, 'users', ['users:read']);
    await rowsOf('Users');
    assert.equal(href('Open Ann Lee'), '/users/u1');
    assert.ok(!screen.queryByRole('link', { name: 'Edit Ann Lee' }));
  });

  it('searches users and highlights the match', async () => {
    const { client, searched } = fakeClient();
    const { user } = show(client);
    await rowsOf('Users');
    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'lee');
    await user.click(button('Search'));
    await waitFor(() => assert.equal(searched.length, 2));
    assert.equal(searched[1], 'q=lee&page=1&pageSize=25&sort=name&dir=asc');
    assert.equal(window.location.search, '?q=lee');
    await waitFor(() =>
      assert.deepEqual(
        [...document.querySelectorAll('mark')].map((m) => m.textContent),
        ['Lee', 'Lee', 'Lee']
      )
    );
    assert.equal(href('Edit Ann Lee'), '/users/u1?back=%2Fusers%3Fq%3Dlee');
  });

  it('sorts users on the server', async () => {
    const { client, searched } = fakeClient();
    const { user } = show(client);
    await rowsOf('Users');
    await user.click(screen.getByRole('link', { name: 'Email' }));
    await waitFor(() => assert.equal(searched.length, 2));
    assert.equal(searched[1], 'page=1&pageSize=25&sort=email&dir=asc');
  });

  it('suggests inviting someone when there are no users', async () => {
    const { client } = fakeClient({ search: async () => pageOf([]) });
    show(client);
    assert.ok(await screen.findByRole('heading', { name: 'No Users Yet' }));
    assert.ok(screen.getByText('Invite someone to work in this agency.'));
  });

  it('offers invitations only to users who may invite', async () => {
    const { client } = fakeClient();
    show(client);
    await rowsOf('Users');
    assert.equal(href('Invite User'), '/users/invite');
  });

  it('hides the invite action from users who may not invite', async () => {
    const { client } = fakeClient();
    show(client, 'users', ['users:read']);
    await rowsOf('Users');
    assert.ok(!screen.queryByRole('link', { name: 'Invite User' }));
  });
});

describe('UsersPage invitations tab', () => {
  it('lists invitations by expiry, marking expired ones', async () => {
    const { client, listed, searched } = fakeClient();
    show(client, 'invitations');
    assert.deepEqual(await rowsOf('Invitations'), [
      ['Bo Ray', 'bo@example.com', 'Biller', formatDateTime('2026-01-08T00:00:00Z')],
      ['Al Ray', 'al@example.com', 'Biller', formatDateTime('2026-01-08T00:00:00Z')],
      ['Cy Ray', 'cy@example.com', 'Biller', 'Expired']
    ]);
    assert.deepEqual(listed, ['page=1&pageSize=25&sort=expires&dir=asc']);
    assert.deepEqual(searched, []);
    assert.equal(
      screen.getByRole('link', { name: 'Invitations', current: 'page' }).getAttribute('href'),
      '/users/invitations'
    );
  });

  it('renews and deletes only invitations the user could grant', async () => {
    const { client } = fakeClient();
    show(client, 'invitations');
    await rowsOf('Invitations');
    assert.ok(button('New Link for Bo Ray'));
    assert.ok(button('Delete invitation for Bo Ray'));
    assert.ok(!screen.queryByRole('button', { name: 'New Link for Al Ray' }));
    assert.ok(!screen.queryByRole('button', { name: 'Delete invitation for Al Ray' }));
  });

  it('neither renews nor deletes invitations without the permissions', async () => {
    const { client } = fakeClient();
    show(client, 'invitations', ['users:read']);
    await rowsOf('Invitations');
    assert.ok(!screen.queryByRole('button', { name: 'New Link for Bo Ray' }));
    assert.ok(!screen.queryByRole('button', { name: 'Delete invitation for Bo Ray' }));
  });

  it('searches invitations and highlights the match', async () => {
    const { client, listed } = fakeClient();
    const { user } = show(client, 'invitations');
    await rowsOf('Invitations');
    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'ray');
    await user.click(button('Search'));
    await waitFor(() => assert.equal(listed.length, 2));
    assert.equal(listed[1], 'q=ray&page=1&pageSize=25&sort=expires&dir=asc');
    await waitFor(() =>
      assert.deepEqual(
        [...document.querySelectorAll('mark')].map((m) => m.textContent),
        ['Ray', 'Ray', 'Ray']
      )
    );
  });

  it('makes a new link once confirmed and shows it', async () => {
    const { client, resent, listed } = fakeClient();
    const { user } = show(client, 'invitations');
    await rowsOf('Invitations');
    await user.click(button('New Link for Bo Ray'));
    const dialog = screen.getByRole('dialog', { name: 'Make a new invitation link?' });
    assert.ok(
      within(dialog).getByText(
        'The old link stops working and the invitation lasts another 7 days.'
      )
    );
    await user.click(within(dialog).getByRole('button', { name: 'Make Link' }));
    assert.ok(await screen.findByRole('heading', { name: 'Invitation for Bo Ray' }));
    assert.equal(
      (screen.getByRole('textbox', { name: 'Link' }) as HTMLInputElement).value,
      'http://app.test/invitation?token=t2'
    );
    assert.deepEqual(resent, ['i1']);
    await waitFor(() => assert.equal(listed.length, 2));
  });

  it('says why a link could not be renewed', async () => {
    const { client, listed } = fakeClient({
      resend: async () => {
        throw new Error('Invitation was accepted');
      }
    });
    const { toasts, user } = show(client, 'invitations');
    await rowsOf('Invitations');
    await user.click(button('New Link for Bo Ray'));
    await user.click(
      within(screen.getByRole('dialog', { name: 'Make a new invitation link?' })).getByRole(
        'button',
        { name: 'Make Link' }
      )
    );
    await waitFor(() =>
      assert.deepEqual(toasts, [
        {
          intent: 'danger',
          title: 'Could not renew invitation',
          description: 'Invitation was accepted'
        }
      ])
    );
    assert.ok(!screen.queryByRole('textbox', { name: 'Link' }));
    assert.equal(listed.length, 1);
  });

  it('deletes an invitation once confirmed and reloads the list', async () => {
    const { client, removed, listed } = fakeClient();
    const { toasts, user } = show(client, 'invitations');
    await rowsOf('Invitations');
    await user.click(button('Delete invitation for Bo Ray'));
    const dialog = screen.getByRole('dialog', { name: 'Delete invitation for Bo Ray?' });
    assert.ok(within(dialog).getByText('Their link stops working.'));
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => assert.deepEqual(toasts, [{ title: 'Invitation for Bo Ray deleted' }]));
    assert.deepEqual(removed, ['i1']);
    await waitFor(() => assert.equal(listed.length, 2));
  });

  it('keeps the invitation when the deletion is not confirmed', async () => {
    const { client, removed } = fakeClient();
    const { user } = show(client, 'invitations');
    await rowsOf('Invitations');
    await user.click(button('Delete invitation for Bo Ray'));
    const dialog = screen.getByRole('dialog', { name: 'Delete invitation for Bo Ray?' });
    await user.click(within(dialog).getByRole('button', { name: 'Keep' }));
    assert.equal(dialog.hasAttribute('open'), false);
    assert.deepEqual(removed, []);
  });

  it('says why an invitation could not be deleted', async () => {
    const { client, listed } = fakeClient({
      removeInvitation: async () => {
        throw new Error('Invitation not found');
      }
    });
    const { toasts, user } = show(client, 'invitations');
    await rowsOf('Invitations');
    await user.click(button('Delete invitation for Bo Ray'));
    await user.click(
      within(screen.getByRole('dialog', { name: 'Delete invitation for Bo Ray?' })).getByRole(
        'button',
        { name: 'Delete' }
      )
    );
    await waitFor(() =>
      assert.deepEqual(toasts, [
        {
          intent: 'danger',
          title: 'Could not delete invitation',
          description: 'Invitation not found'
        }
      ])
    );
    assert.equal(listed.length, 1);
  });

  it('says when there are no invitations', async () => {
    const { client } = fakeClient({ invitations: async () => pageOf([]) });
    show(client, 'invitations');
    assert.ok(await screen.findByRole('heading', { name: 'No Invitations' }));
  });
});
