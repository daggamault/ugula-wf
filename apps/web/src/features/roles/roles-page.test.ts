import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Permission } from '@ugula/access';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AccessProvider } from '../../shared/access.tsx';
import { idleLive } from '../../shared/testing.ts';
import { searchStateOf } from '../../shared/url-state.ts';
import type { Role, RolesClient } from './client.ts';
import { ROLE_TABLE, RolesPage, RolesTable } from './roles-page.tsx';

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

const table = (canEdit: boolean, canDelete: boolean) =>
  renderToStaticMarkup(
    createElement(RolesTable, {
      roles: [role({}), role({ id: 'r2', name: 'Admin', isGrantable: false })],
      search: searchStateOf('/roles', new URLSearchParams('q=bill'), ROLE_TABLE),
      canEdit,
      canDelete,
      onDelete: () => undefined
    })
  );

const page = (permissions: Permission[]) =>
  renderToStaticMarkup(
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
      children: createElement(RolesPage, {
        live: idleLive,
        client: { search: () => new Promise(() => undefined) } as unknown as RolesClient
      })
    })
  );

describe('RolesPage', () => {
  it('edits and deletes only the roles the user could grant', () => {
    const html = table(true, true);
    assert.ok(
      html.includes('aria-label="Edit Biller"') && html.includes('aria-label="Delete Biller"')
    );
    assert.ok(html.includes('href="/roles/r1?back=%2Froles%3Fq%3Dbill"'));
    assert.ok(html.includes('aria-label="Open Admin"') && !html.includes('Delete Admin'));
    assert.match(html, /<mark[^>]*>Bill<\/mark>er/);
  });

  it('only opens roles without edit or delete permissions', () => {
    const html = table(false, false);
    assert.ok(html.includes('aria-label="Open Biller"'));
    assert.ok(!html.includes('Edit Biller') && !html.includes('Delete Biller'));
  });

  it('offers to add roles only to users who may create them', () => {
    const html = page(['roles:read', 'roles:create']);
    assert.ok(html.includes('aria-label="Search Roles"'));
    assert.ok(html.includes('href="/roles/new"') && html.includes('Add Role'));
    assert.ok(!page(['roles:read']).includes('Add Role'));
  });
});
