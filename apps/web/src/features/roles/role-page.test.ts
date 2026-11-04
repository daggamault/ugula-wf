import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PermissionGrant, Role, RolesClient } from './client.ts';
import { RoleForm, RolePage } from './role-page.tsx';

const role: Role = {
  id: 'r1',
  name: 'Biller',
  version: 1,
  users: 2,
  permissions: ['claims:read'],
  isGrantable: true,
  updatedAt: '2026-01-01T00:00:00.000Z'
};

const grants: PermissionGrant[] = [
  { permission: 'claims:read', description: 'See claims.', isGrantable: true }
];

const form = (readOnly: boolean, r: Role | null = role) =>
  renderToStaticMarkup(
    createElement(RoleForm, {
      role: r,
      grants,
      readOnly,
      back: '/roles',
      onSave: async () => null
    })
  );

describe('RoleForm', () => {
  it('edits the name and permissions of a role', () => {
    const html = form(false);
    assert.ok(html.includes('value="Biller"'));
    assert.match(html, /aria-label="View Claims"[^>]*checked=""/);
    assert.ok(html.includes('Save Role') && html.includes('href="/roles"'));
  });

  it('starts a new role empty', () => {
    const html = form(false, null);
    assert.ok(html.includes('value=""'));
    assert.doesNotMatch(html, /aria-label="View Claims"[^>]*checked=""/);
  });

  it('shows a role it cannot change without save actions', () => {
    const html = form(true);
    assert.ok(!html.includes('Save Role'));
    assert.ok(html.includes('readOnly=""'));
  });
});

describe('RolePage', () => {
  it('waits for the role and the grantable permissions', () => {
    const pending = () => new Promise(() => undefined);
    const html = renderToStaticMarkup(
      createElement(RolePage, {
        client: { grants: pending, role: pending } as unknown as RolesClient,
        roleId: 'r1',
        back: '/roles'
      })
    );
    assert.ok(html.includes('aria-label="Loading"'));
  });
});
