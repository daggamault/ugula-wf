import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { UsersClient } from './client.ts';
import { InvitePage, inviteProblem } from './invite-page.tsx';

const input = { email: 'ann@example.com', firstName: 'Ann', lastName: 'Lee', roleId: 'r1' };

describe('inviteProblem', () => {
  it('asks for a name, a valid email and a role', () => {
    assert.equal(inviteProblem({ ...input, firstName: ' ' }), 'Enter their first and last name.');
    assert.equal(inviteProblem({ ...input, lastName: '' }), 'Enter their first and last name.');
    assert.equal(inviteProblem({ ...input, email: 'ann' }), 'Enter their email address.');
    assert.equal(inviteProblem({ ...input, email: 'a b@c.d' }), 'Enter their email address.');
    assert.equal(inviteProblem({ ...input, roleId: '' }), 'Choose a role.');
    assert.equal(inviteProblem({ ...input, email: ' ann@example.com ' }), null);
  });
});

describe('InvitePage', () => {
  it('waits for the roles it can grant', () => {
    const html = renderToStaticMarkup(
      createElement(InvitePage, {
        client: { roles: () => new Promise(() => undefined) } as unknown as UsersClient,
        back: '/users'
      })
    );
    assert.ok(html.includes('aria-label="Loading"'));
  });
});
