import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Permission } from '@ugula/access';
import { createElement } from 'react';
import { AccessProvider } from '../../shared/access.tsx';
import { render, screen, userEvent, waitFor, within } from '../../shared/testing-dom.ts';
import { type ToastInput, ToastProvider } from '../../shared/ui/toast.tsx';
import type { AgencyUser, UsersClient } from './client.ts';
import { UserPage } from './user-page.tsx';

const ann: AgencyUser = {
  id: 'u1',
  email: 'ann@example.com',
  firstName: 'Ann',
  lastName: 'Lee',
  isOwner: false,
  version: 3,
  role: { id: 'r1', name: 'Biller' },
  blockedReason: null
};

const roles = [
  { id: 'r1', name: 'Biller', isGrantable: true },
  { id: 'r2', name: 'Admin', isGrantable: false },
  { id: 'r3', name: 'Auditor', isGrantable: true }
];

const ALL: Permission[] = ['users:read', 'users:update', 'users:delete'];

const fakeClient = (over: Partial<UsersClient> = {}) => {
  const read: string[] = [];
  const set: [string, { roleId: string; version: number }][] = [];
  const removed: string[] = [];
  const linked: string[] = [];
  const client = {
    user: async (id: string) => {
      read.push(id);
      return ann;
    },
    roles: async () => roles,
    setRole: async (id: string, input: { roleId: string; version: number }) => {
      set.push([id, input]);
      return ann;
    },
    remove: async (id: string) => {
      removed.push(id);
      return { id };
    },
    passwordLink: async (id: string) => {
      linked.push(id);
      return { link: 'http://app.test/reset?token=t1' };
    },
    ...over
  } as UsersClient;
  return { client, read, set, removed, linked };
};

const show = (client: UsersClient, permissions: Permission[] = ALL) => {
  const toasts: ToastInput[] = [];
  render(
    createElement(AccessProvider, {
      access: {
        agencyId: 'a1',
        agencyName: 'North EMS',
        organizationId: 'o1',
        organizationName: 'Acme',
        userId: 'u0',
        isOrganizationAdmin: false,
        permissions
      },
      children: createElement(
        ToastProvider,
        { onNotify: (t) => toasts.push(t) },
        createElement(UserPage, { client, userId: 'u1', back: '/users?q=ann' })
      )
    })
  );
  return { toasts, user: userEvent.setup() };
};

const form = () => screen.findByRole('form', { name: 'Save User' });

const button = (name: string) => screen.getByRole('button', { name });

const roleList = () => screen.getByRole('listbox', { name: 'Role' });

const roleOptions = () =>
  within(roleList())
    .getAllByRole('option')
    .map((o) => o.textContent);

const isLocked = () => roleList().closest('fieldset')?.disabled === true;

const reason = (name: string) =>
  document.getElementById(button(name).getAttribute('aria-describedby') ?? '')?.textContent;

describe('UserPage', () => {
  it('waits for the user and the roles', () => {
    const pending = () => new Promise(() => undefined);
    show({ user: pending, roles: pending } as unknown as UsersClient);
    assert.ok(screen.getByLabelText('Loading'));
    assert.ok(!screen.queryByRole('form', { name: 'Save User' }));
  });

  it('says why the user could not be loaded', async () => {
    const { client } = fakeClient({
      user: async () => {
        throw new Error('User not found');
      }
    });
    show(client);
    assert.ok(await screen.findByRole('heading', { name: 'Something Went Wrong' }));
    assert.ok(screen.getByText('User not found'));
  });

  it('opens the user with their email and the roles that may be given', async () => {
    const { client, read } = fakeClient();
    show(client);
    assert.ok(await screen.findByRole('heading', { name: 'Ann Lee', level: 1 }));
    assert.ok(screen.getByText('ann@example.com'));
    assert.deepEqual(roleOptions(), ['Biller', 'Auditor']);
    assert.equal(within(roleList()).getByRole('option', { selected: true }).textContent, 'Biller');
    assert.ok(!screen.queryByText('Owner, with full access to every agency'));
    assert.deepEqual(read, ['u1']);
  });

  it('keeps a role the user could not grant when the person already has it', async () => {
    const { client } = fakeClient({
      user: async () => ({ ...ann, role: { id: 'r2', name: 'Admin' } })
    });
    show(client);
    await form();
    assert.deepEqual(roleOptions(), ['Biller', 'Admin', 'Auditor']);
  });

  it('marks an organization owner', async () => {
    const { client } = fakeClient({ user: async () => ({ ...ann, isOwner: true }) });
    show(client);
    assert.ok(await screen.findByText('Owner, with full access to every agency'));
  });

  it('saves a new role with the version it read', async () => {
    const { client, set, read } = fakeClient();
    const { toasts, user } = show(client);
    await form();
    assert.equal(reason('Save User'), 'Choose a different role first.');
    await user.click(within(roleList()).getByRole('option', { name: 'Auditor' }));
    await user.click(button('Save User'));
    assert.deepEqual(set, [['u1', { roleId: 'r3', version: 3 }]]);
    await waitFor(() => assert.deepEqual(toasts, [{ title: 'Ann Lee saved' }]));
    await waitFor(() => assert.deepEqual(read, ['u1', 'u1']));
  });

  it('does not save the role the user already has', async () => {
    const { client, set } = fakeClient();
    const { user } = show(client);
    await form();
    await user.click(button('Save User'));
    assert.deepEqual(set, []);
  });

  it('shows why the server refused the save', async () => {
    const { client } = fakeClient({
      setRole: async () => {
        throw new Error('User changed since you opened it');
      }
    });
    const { toasts, user } = show(client);
    await form();
    await user.click(within(roleList()).getByRole('option', { name: 'Auditor' }));
    await user.click(button('Save User'));
    assert.equal(
      (await screen.findByRole('alert')).textContent,
      'User changed since you opened it'
    );
    assert.deepEqual(toasts, []);
  });

  it('removes the user once confirmed and goes back', async () => {
    const { client, removed } = fakeClient();
    const { toasts, user } = show(client);
    await form();
    await user.click(button('Remove User'));
    const dialog = screen.getByRole('dialog', { name: 'Remove Ann Lee?' });
    assert.ok(
      within(dialog).getByText(
        'They lose access to this agency. Tasks assigned to them become unassigned.'
      )
    );
    await user.click(within(dialog).getByRole('button', { name: 'Remove User' }));
    await waitFor(() => assert.deepEqual(toasts, [{ title: 'Ann Lee removed' }]));
    assert.deepEqual(removed, ['u1']);
    assert.equal(`${window.location.pathname}${window.location.search}`, '/users?q=ann');
  });

  it('keeps the user when the removal is not confirmed', async () => {
    const { client, removed } = fakeClient();
    const { user } = show(client);
    await form();
    await user.click(button('Remove User'));
    const dialog = screen.getByRole('dialog', { name: 'Remove Ann Lee?' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    assert.equal(dialog.hasAttribute('open'), false);
    assert.deepEqual(removed, []);
  });

  it('makes a password link to send them', async () => {
    const { client, linked } = fakeClient();
    const { user } = show(client);
    await form();
    await user.click(button('Password Link'));
    assert.ok(await screen.findByRole('heading', { name: 'Password Link' }));
    assert.ok(
      screen.getByText('Send this link so they can set a new password. It expires in 24 hours.')
    );
    assert.equal(
      (screen.getByRole('textbox', { name: 'Link' }) as HTMLInputElement).value,
      'http://app.test/reset?token=t1'
    );
    assert.deepEqual(linked, ['u1']);
  });

  it('shows the user read only to those who may not change or remove users', async () => {
    const { client } = fakeClient();
    show(client, ['users:read']);
    await form();
    assert.equal(isLocked(), true);
    assert.ok(!screen.queryByRole('button', { name: 'Save User' }));
    assert.ok(!screen.queryByRole('button', { name: 'Password Link' }));
    assert.ok(!screen.queryByRole('button', { name: 'Remove User' }));
  });

  it('explains that users cannot change their own access, but may get a password link', async () => {
    const { client } = fakeClient({ user: async () => ({ ...ann, blockedReason: 'self' }) });
    show(client);
    await form();
    assert.ok(screen.getByText("You can't change your own access."));
    assert.equal(isLocked(), true);
    assert.ok(!screen.queryByRole('button', { name: 'Save User' }));
    assert.ok(!screen.queryByRole('button', { name: 'Remove User' }));
    assert.ok(button('Password Link'));
  });

  it('leaves a user holding permissions the viewer lacks untouched', async () => {
    const { client } = fakeClient({ user: async () => ({ ...ann, blockedReason: 'outranked' }) });
    show(client);
    await form();
    assert.ok(screen.getByText('This user has permissions you do not hold.'));
    assert.equal(isLocked(), true);
    assert.ok(!screen.queryByRole('button', { name: 'Save User' }));
    assert.ok(!screen.queryByRole('button', { name: 'Remove User' }));
    assert.ok(!screen.queryByRole('button', { name: 'Password Link' }));
  });
});
