import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Permission } from '@ugula/access';
import { createElement } from 'react';
import { AccessProvider } from '../../shared/access.tsx';
import { render, screen, userEvent, waitFor } from '../../shared/testing-dom.ts';
import { type ToastInput, ToastProvider } from '../../shared/ui/toast.tsx';
import type { PermissionGrant, Role, RoleInput, RolesClient } from './client.ts';
import { isRoleChanged, RolePage } from './role-page.tsx';

const role: Role = {
  id: 'r1',
  name: 'Biller',
  version: 3,
  users: 2,
  permissions: ['claims:read'],
  isGrantable: true,
  updatedAt: '2026-01-01T00:00:00.000Z'
};

const grants: PermissionGrant[] = [
  { permission: 'claims:read', description: 'See claims.', isGrantable: true },
  { permission: 'users:read', description: 'See users.', isGrantable: true }
];

const fakeClient = (over: Partial<RolesClient> = {}) => {
  const created: RoleInput[] = [];
  const updated: [string, RoleInput & { version: number }][] = [];
  const client = {
    grants: async () => grants,
    role: async () => role,
    create: async (input: RoleInput) => {
      created.push(input);
      return { id: 'r2' };
    },
    update: async (id: string, input: RoleInput & { version: number }) => {
      updated.push([id, input]);
      return role;
    },
    ...over
  } as RolesClient;
  return { client, created, updated };
};

const show = (
  client: RolesClient,
  roleId: string | null,
  permissions: Permission[] = ['roles:create', 'roles:update']
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
        createElement(RolePage, { client, roleId, back: '/roles?q=bill' })
      )
    })
  );
  return toasts;
};

const nameInput = () => screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement;

const box = (name: string) => screen.getByRole('checkbox', { name }) as HTMLInputElement;

const isLocked = (el: HTMLElement) => el.closest('fieldset')?.disabled === true;

describe('isRoleChanged', () => {
  it('tells unsaved edits from the saved role, whatever the permission order', () => {
    const both: Role = { ...role, permissions: ['claims:read', 'runs:read'] };
    const saved: RoleInput = { name: 'Biller', permissions: ['runs:read', 'claims:read'] };
    assert.equal(isRoleChanged(both, saved), false);
    assert.equal(isRoleChanged(both, { ...saved, name: 'Other' }), true);
    assert.equal(isRoleChanged(both, { ...saved, permissions: ['runs:read'] }), true);
    assert.equal(isRoleChanged(null, { name: '', permissions: [] }), false);
  });
});

describe('RolePage', () => {
  it('shows a spinner until the role and the grantable permissions load', () => {
    const pending = () => new Promise<never>(() => undefined);
    show({ grants: pending, role: pending } as unknown as RolesClient, 'r1');
    assert.ok(screen.getByLabelText('Loading'));
    assert.ok(!screen.queryByRole('form', { name: 'Save role' }));
  });

  it('opens the role with its name, users and permissions', async () => {
    const roles: string[] = [];
    const { client } = fakeClient({
      role: async (id: string) => {
        roles.push(id);
        return role;
      }
    });
    show(client, 'r1');
    assert.ok(await screen.findByRole('heading', { name: 'Biller', level: 1 }));
    assert.ok(screen.getByText('2 users have this role.'));
    assert.equal(nameInput().value, 'Biller');
    assert.equal(box('View Claims').checked, true);
    assert.equal(box('View Users').checked, false);
    assert.deepEqual(roles, ['r1']);
  });

  it('says when a single user has the role', async () => {
    const { client } = fakeClient({ role: async () => ({ ...role, users: 1 }) });
    show(client, 'r1');
    assert.ok(await screen.findByText('1 user has this role.'));
  });

  it('saves the edited name and permissions with the version it read, then goes back', async () => {
    const { client, updated } = fakeClient();
    const toasts = show(client, 'r1');
    await screen.findByRole('form', { name: 'Save role' });
    const user = userEvent.setup();
    await user.clear(nameInput());
    await user.type(nameInput(), '  Senior Biller ');
    await user.click(box('View Users'));
    await user.click(screen.getByRole('button', { name: 'Save Role' }));
    assert.deepEqual(updated, [
      ['r1', { name: 'Senior Biller', permissions: ['claims:read', 'users:read'], version: 3 }]
    ]);
    assert.deepEqual(toasts, [{ title: 'Senior Biller saved' }]);
    assert.equal(`${window.location.pathname}${window.location.search}`, '/roles?q=bill');
  });

  it('creates a new role from an empty form', async () => {
    const { client, created, updated } = fakeClient();
    const toasts = show(client, null);
    assert.ok(await screen.findByRole('heading', { name: 'New Role', level: 1 }));
    assert.equal(nameInput().value, '');
    assert.equal(box('View Claims').checked, false);
    const user = userEvent.setup();
    await user.type(nameInput(), 'Auditor');
    await user.click(box('View Claims'));
    await user.click(screen.getByRole('button', { name: 'Save Role' }));
    assert.deepEqual(created, [{ name: 'Auditor', permissions: ['claims:read'] }]);
    assert.deepEqual(updated, []);
    assert.deepEqual(toasts, [{ title: 'Auditor saved' }]);
  });

  it('asks for a name before saving', async () => {
    const { client, created } = fakeClient();
    show(client, null);
    const user = userEvent.setup();
    await user.type(await screen.findByRole('textbox', { name: 'Name' }), '   ');
    await user.click(screen.getByRole('button', { name: 'Save Role' }));
    assert.equal(screen.getByRole('alert').textContent, 'Enter a name.');
    assert.deepEqual(created, []);
  });

  it('locks the form while saving', async () => {
    let finish: (failure: Error) => void = () => undefined;
    const { client } = fakeClient({
      update: () =>
        new Promise((_, reject) => {
          finish = reject;
        })
    });
    show(client, 'r1');
    const user = userEvent.setup();
    await screen.findByRole('form', { name: 'Save role' });
    await user.click(screen.getByRole('button', { name: 'Save Role' }));
    const save = screen.getByRole('button', { name: 'Save Role' });
    assert.equal(save.getAttribute('aria-busy'), 'true');
    assert.equal(isLocked(nameInput()), true);
    assert.equal(isLocked(box('View Users')), true);
    finish(new Error('Role changed since you opened it'));
    await waitFor(() => assert.equal(isLocked(nameInput()), false));
    assert.equal(save.getAttribute('aria-busy'), null);
  });

  it('shows why the server refused the save and stays on the role', async () => {
    const { client } = fakeClient({
      update: async () => {
        throw new Error('Role changed since you opened it');
      }
    });
    const toasts = show(client, 'r1');
    await screen.findByRole('form', { name: 'Save role' });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Save Role' }));
    assert.equal(
      (await screen.findByRole('alert')).textContent,
      'Role changed since you opened it'
    );
    assert.deepEqual(toasts, []);
    assert.equal(window.location.pathname, '/');
  });

  it('shows a role read only to users who may not change roles', async () => {
    const { client } = fakeClient();
    show(client, 'r1', ['roles:read']);
    await screen.findByRole('form', { name: 'Save role' });
    assert.equal(nameInput().readOnly, true);
    assert.equal(box('View Users').disabled, true);
    assert.ok(!screen.queryByRole('button', { name: 'Save Role' }));
  });

  it('shows a role holding permissions the user lacks read only', async () => {
    const { client } = fakeClient({ role: async () => ({ ...role, isGrantable: false }) });
    show(client, 'r1');
    await screen.findByRole('form', { name: 'Save role' });
    assert.equal(nameInput().readOnly, true);
    assert.ok(!screen.queryByRole('button', { name: 'Save Role' }));
  });

  it('shows a new role read only to users who may not create roles', async () => {
    const { client } = fakeClient();
    show(client, null, ['roles:update']);
    await screen.findByRole('form', { name: 'Save role' });
    assert.equal(nameInput().readOnly, true);
    assert.ok(!screen.queryByRole('button', { name: 'Save Role' }));
  });

  it('says why the role could not be loaded', async () => {
    const { client } = fakeClient({
      role: async () => {
        throw new Error('Role not found');
      }
    });
    show(client, 'r1');
    assert.ok(await screen.findByRole('heading', { name: 'Something Went Wrong' }));
    assert.ok(screen.getByText('Role not found'));
  });
});
