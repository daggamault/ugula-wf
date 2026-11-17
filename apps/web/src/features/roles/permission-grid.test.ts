import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PERMISSION_RESOURCES, type Permission } from '@ugula/access';
import { createElement } from 'react';
import { render, screen, userEvent, within } from '../../shared/testing-dom.ts';
import type { PermissionGrant } from './client.ts';
import { PermissionGrid, toggled } from './permission-grid.tsx';

const grants: PermissionGrant[] = [
  { permission: 'claims:read', description: 'See claims.', isGrantable: true },
  { permission: 'claims:update', description: 'Change claims.', isGrantable: false },
  { permission: 'users:read', description: 'See users.', isGrantable: true }
];

const box = (name: string) => screen.getByRole('checkbox', { name }) as HTMLInputElement;

const show = (props: { selected: Permission[]; readOnly?: boolean }) => {
  const changes: Permission[][] = [];
  render(
    createElement(PermissionGrid, { grants, ...props, onChange: (next) => changes.push(next) })
  );
  return changes;
};

describe('toggled', () => {
  it('adds a permission in sorted order or takes it away', () => {
    assert.deepEqual(toggled(['users:read'], 'claims:read'), ['claims:read', 'users:read']);
    assert.deepEqual(toggled(['claims:read', 'users:read'], 'claims:read'), ['users:read']);
  });
});

describe('PermissionGrid', () => {
  it('shows one row per area and a column per action in use', () => {
    show({ selected: ['claims:read'] });
    const table = screen.getByRole('table', { name: 'Permissions' });
    assert.deepEqual(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
      ['Area', 'View', 'Change']
    );
    assert.equal(within(table).getAllByRole('row').length, PERMISSION_RESOURCES.length + 1);
    assert.equal(within(table).getAllByRole('checkbox').length, grants.length);
    assert.equal(box('View Claims').checked, true);
    assert.equal(box('View Claims').title, 'See claims.');
    assert.equal(box('View Users').checked, false);
  });

  it('grants a permission in sorted order when its box is ticked', async () => {
    const changes = show({ selected: ['users:read'] });
    await userEvent.setup().click(box('View Claims'));
    assert.deepEqual(changes, [['claims:read', 'users:read']]);
  });

  it('takes a permission away when its box is cleared', async () => {
    const changes = show({ selected: ['claims:read', 'users:read'] });
    await userEvent.setup().click(box('View Users'));
    assert.deepEqual(changes, [['claims:read']]);
  });

  it('locks permissions the user cannot grant and explains why', async () => {
    const changes = show({ selected: [] });
    assert.equal(box('Change Claims').disabled, true);
    assert.equal(box('View Claims').disabled, false);
    assert.equal(screen.getAllByText("You can't grant permissions you don't hold.").length, 1);
    await userEvent.setup().click(box('Change Claims'));
    assert.deepEqual(changes, []);
  });

  it('locks every box when read only, without the grant explanation', () => {
    show({ selected: ['claims:read'], readOnly: true });
    for (const b of screen.getAllByRole('checkbox')) {
      assert.equal((b as HTMLInputElement).disabled, true);
    }
    assert.ok(!screen.queryByText("You can't grant permissions you don't hold."));
  });
});
