import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Permission } from '@ugula/access';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { type Access, AccessProvider } from '../../shared/access.tsx';
import { idleLive } from '../../shared/testing.ts';
import { searchStateOf } from '../../shared/url-state.ts';
import type { AgencyUser, Invitation, UsersClient } from './client.ts';
import {
  INVITATION_TABLE,
  InvitationsTable,
  USER_TABLE,
  UsersPage,
  type UsersTab,
  UsersTable
} from './users-page.tsx';

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

const page = (permissions: Permission[], tab: UsersTab = 'users') =>
  renderToStaticMarkup(
    createElement(AccessProvider, {
      access: access(permissions),
      children: createElement(UsersPage, {
        live: idleLive,
        tab,
        client: { search: pending, invitations: pending } as unknown as UsersClient
      })
    })
  );

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
    assert.ok(invites.includes('aria-label="Search Users"'));
    assert.ok(invites.includes('href="/users/invitations"'));
    assert.ok(!page(['users:read']).includes('Invite User'));
  });

  it('searches invitations on their own tab', () => {
    const html = page(['users:read'], 'invitations');
    assert.ok(html.includes('aria-label="Search Invitations"'));
    assert.match(
      html,
      /aria-current="page"[^>]*href="\/users\/invitations"|href="\/users\/invitations"[^>]*aria-current="page"/
    );
  });

  it('sorts invitations on the server and renews or deletes only grantable ones', () => {
    const html = renderToStaticMarkup(
      createElement(InvitationsTable, {
        invitations: [
          invitation({}),
          invitation({ id: 'i2', firstName: 'Al', isGrantable: false })
        ],
        search: searchStateOf('/users/invitations', new URLSearchParams('q=ray'), INVITATION_TABLE),
        canInvite: true,
        canRemove: true,
        onResend: () => undefined,
        onRemove: () => undefined
      })
    );
    assert.ok(html.includes('href="/users/invitations?q=ray&amp;sort=name&amp;dir=asc"'));
    assert.ok(html.includes('aria-sort="ascending"'));
    assert.ok(html.includes('aria-label="New Link for Bo Ray"'));
    assert.ok(html.includes('aria-label="Delete invitation for Bo Ray"'));
    assert.ok(!html.includes('New Link for Al Ray'));
    assert.match(html, /<mark[^>]*>Ray<\/mark>/);
  });
});
