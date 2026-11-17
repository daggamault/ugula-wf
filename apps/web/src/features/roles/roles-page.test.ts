import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Permission } from '@ugula/access';
import { createElement } from 'react';
import { AccessProvider } from '../../shared/access.tsx';
import { idleLive } from '../../shared/testing.ts';
import { render, screen, userEvent, waitFor, within } from '../../shared/testing-dom.ts';
import { type ToastInput, ToastProvider } from '../../shared/ui/toast.tsx';
import type { Page } from '../../shared/url-state.ts';
import type { Role, RolesClient } from './client.ts';
import { RolesPage } from './roles-page.tsx';

const role = (patch: Partial<Role>): Role => ({
  id: 'r1',
  name: 'Biller',
  version: 1,
  users: 3,
  permissions: ['claims:read', 'claims:update'],
  isGrantable: true,
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...patch
});

const listed = [role({}), role({ id: 'r2', name: 'Admin', isGrantable: false })];

const pageOf = (items: Role[]): Page<Role> => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 25
});

const fakeClient = (over: Partial<RolesClient> = {}) => {
  const queries: string[] = [];
  const removed: string[] = [];
  const client = {
    search: async (query: string) => {
      queries.push(query);
      return pageOf(listed);
    },
    remove: async (id: string) => {
      removed.push(id);
      return { id };
    },
    ...over
  } as RolesClient;
  return { client, queries, removed };
};

const show = (
  client: RolesClient,
  permissions: Permission[] = ['roles:read', 'roles:create', 'roles:update', 'roles:delete']
) => {
  const toasts: ToastInput[] = [];
  render(
    createElement(AccessProvider, {
      access: {
        agencyId: 'a1',
        agencyName: 'North EMS',
        organizationId: 'o1',
        organizationName: 'Acme',
        userId: 'u1',
        isOrganizationAdmin: false,
        permissions
      },
      children: createElement(
        ToastProvider,
        { onNotify: (t) => toasts.push(t) },
        createElement(RolesPage, { client, live: idleLive })
      )
    })
  );
  return toasts;
};

const table = () => screen.findByRole('table', { name: 'Roles' });

describe('RolesPage', () => {
  it('lists the roles with their permission and user counts', async () => {
    const { client, queries } = fakeClient();
    show(client);
    const rows = within(await table()).getAllByRole('row');
    assert.equal(rows.length, 3);
    const biller = rows[1];
    assert.ok(biller);
    assert.deepEqual(
      within(biller)
        .getAllByRole('cell')
        .slice(0, 3)
        .map((c) => c.textContent),
      ['Biller', 'Permissions2', 'Users3']
    );
    assert.deepEqual(queries, ['page=1&pageSize=25&sort=name&dir=asc']);
  });

  it('searches roles by name and highlights the match', async () => {
    const { client, queries } = fakeClient();
    show(client);
    await table();
    const user = userEvent.setup();
    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'bill');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => assert.equal(queries.length, 2));
    assert.equal(queries[1], 'q=bill&page=1&pageSize=25&sort=name&dir=asc');
    assert.equal(window.location.search, '?q=bill');
    await waitFor(() => assert.equal(document.querySelector('mark')?.textContent, 'Bill'));
    assert.equal(
      screen.getByRole('link', { name: 'Edit Biller' }).getAttribute('href'),
      '/roles/r1?back=%2Froles%3Fq%3Dbill'
    );
  });

  it('edits and deletes only the roles the user could grant', async () => {
    const { client } = fakeClient();
    show(client);
    await table();
    assert.ok(screen.getByRole('link', { name: 'Edit Biller' }));
    assert.ok(screen.getByRole('button', { name: 'Delete Biller' }));
    assert.ok(screen.getByRole('link', { name: 'Open Admin' }));
    assert.ok(!screen.queryByRole('link', { name: 'Edit Admin' }));
    assert.ok(!screen.queryByRole('button', { name: 'Delete Admin' }));
  });

  it('only opens roles for users who may not change or delete them', async () => {
    const { client } = fakeClient();
    show(client, ['roles:read']);
    await table();
    assert.ok(screen.getByRole('link', { name: 'Open Biller' }));
    assert.ok(!screen.queryByRole('link', { name: 'Edit Biller' }));
    assert.ok(!screen.queryByRole('button', { name: 'Delete Biller' }));
    assert.ok(!screen.queryByRole('link', { name: 'Add Role' }));
  });

  it('offers to add a role that returns to the list', async () => {
    const { client } = fakeClient();
    show(client);
    await table();
    assert.equal(screen.getByRole('link', { name: 'Add Role' }).getAttribute('href'), '/roles/new');
    const user = userEvent.setup();
    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'bill');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() =>
      assert.equal(
        screen.getByRole('link', { name: 'Add Role' }).getAttribute('href'),
        '/roles/new?back=%2Froles%3Fq%3Dbill'
      )
    );
  });

  it('suggests adding a role when there are none', async () => {
    const { client } = fakeClient({ search: async () => pageOf([]) });
    show(client);
    assert.ok(await screen.findByRole('heading', { name: 'No Roles Yet' }));
    assert.equal(screen.getAllByRole('link', { name: 'Add Role' }).length, 2);
  });

  it('deletes a role once confirmed and reloads the list', async () => {
    const { client, queries, removed } = fakeClient();
    const toasts = show(client);
    await table();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Delete Biller' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete Biller?' });
    assert.ok(within(dialog).getByText('Users with this role must be given another role first.'));
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => assert.deepEqual(toasts, [{ title: 'Biller deleted' }]));
    assert.deepEqual(removed, ['r1']);
    await waitFor(() => assert.equal(queries.length, 2));
  });

  it('keeps the role when the deletion is not confirmed', async () => {
    const { client, removed } = fakeClient();
    show(client);
    await table();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Delete Biller' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete Biller?' });
    await user.click(within(dialog).getByRole('button', { name: 'Keep' }));
    assert.equal(dialog.hasAttribute('open'), false);
    assert.deepEqual(removed, []);
  });

  it('says why a role could not be deleted', async () => {
    const { client, queries } = fakeClient({
      remove: async () => {
        throw new Error('Role is held by 3 users');
      }
    });
    const toasts = show(client);
    await table();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Delete Biller' }));
    await user.click(
      within(screen.getByRole('dialog', { name: 'Delete Biller?' })).getByRole('button', {
        name: 'Delete'
      })
    );
    await waitFor(() =>
      assert.deepEqual(toasts, [
        { intent: 'danger', title: 'Could not delete role', description: 'Role is held by 3 users' }
      ])
    );
    assert.equal(queries.length, 1);
  });
});
