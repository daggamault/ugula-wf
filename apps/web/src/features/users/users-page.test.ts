import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Permission } from '@ugula/access';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { type Access, AccessProvider } from '../../shared/access.tsx';
import { idleLive } from '../../shared/testing.ts';
import { searchStateOf } from '../../shared/url-state.ts';
import type { AgencyUser, UsersClient } from './client.ts';
import { USER_TABLE, UsersPage, UsersTable } from './users-page.tsx';

const user = (patch: Partial<AgencyUser>): AgencyUser => ({
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

const access = (permissions: Permission[]): Access => ({
  agencyId: 'a1',
  agencyName: 'North EMS',
  organizationId: 'o1',
  organizationName: 'Acme',
  userId: 'u0',
  isOrganizationAdmin: false,
  permissions
});

const pending = () => new Promise<never>(() => undefined);

const page = (permissions: Permission[]) =>
  renderToStaticMarkup(
    createElement(AccessProvider, {
      access: access(permissions),
      children: createElement(UsersPage, {
        live: idleLive,
        client: { search: pending, invitations: pending } as unknown as UsersClient
      })
    })
  );

describe('UsersPage', () => {
  it('lists users with their roles and only edits the ones that can be changed', () => {
    const html = renderToStaticMarkup(
      createElement(UsersTable, {
        users: [
          user({}),
          user({ id: 'u2', firstName: 'Me', blockedReason: 'self' }),
          user({ id: 'u3', firstName: 'Boss', isOwner: true, blockedReason: 'outranked' })
        ],
        search: searchStateOf('/users', new URLSearchParams('q=lee'), USER_TABLE),
        canEdit: true
      })
    );
    assert.ok(html.includes('aria-label="Edit Ann Lee"'));
    assert.ok(html.includes('href="/users/u1?back=%2Fusers%3Fq%3Dlee"'));
    assert.ok(html.includes('aria-label="Open Me Lee"') && html.includes('>You<'));
    assert.ok(html.includes('aria-label="Open Boss Lee"') && html.includes('>Owner<'));
    assert.ok(html.includes('Biller'));
    assert.match(html, /<mark[^>]*>Lee<\/mark>/);
  });

  it('opens rather than edits users without the update permission', () => {
    const html = renderToStaticMarkup(
      createElement(UsersTable, {
        users: [user({})],
        search: searchStateOf('/users', new URLSearchParams(), USER_TABLE),
        canEdit: false
      })
    );
    assert.ok(html.includes('aria-label="Open Ann Lee"') && !html.includes('Edit Ann Lee'));
  });

  it('offers invitations only to users who may invite', () => {
    const invites = page(['users:read', 'users:create']);
    assert.ok(invites.includes('href="/users/invite"'));
    assert.ok(invites.includes('aria-label="Search Users"') && invites.includes('Invitations'));
    assert.ok(invites.includes('No one is waiting to join.'));
    assert.ok(!page(['users:read']).includes('Invite User'));
  });
});
