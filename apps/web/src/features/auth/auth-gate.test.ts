import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AuthGate, AuthGateView } from './auth-gate.tsx';
import type { AuthClient, AuthSession } from './client.ts';

const mockSession: AuthSession = {
  user: { id: 'u-1', tenantId: 't-1', email: 'dev@example.com' },
  sseUrl: 'http://localhost:3002'
};

const mockAuth: AuthClient = {
  signIn: async () => mockSession,
  signOut: async () => undefined,
  getMe: async () => null
};

describe('AuthGate', () => {
  it('renders null while initial session check is pending', () => {
    const html = renderToStaticMarkup(createElement(AuthGate, { auth: mockAuth }));
    assert.equal(html, '');
  });

  it('renders standalone centered sign-in page when ready and unauthenticated', () => {
    const html = renderToStaticMarkup(
      createElement(AuthGateView, {
        ready: true,
        session: null,
        auth: mockAuth,
        onSessionChange: () => undefined
      })
    );
    assert.ok(html.includes('<main'));
    assert.ok(html.includes('Sign in to your account.'));
    assert.ok(!html.includes('<aside'));
  });

  it('renders admin side-nav shell with user email, status, and sign-out when authenticated', () => {
    const html = renderToStaticMarkup(
      createElement(
        AuthGateView,
        {
          ready: true,
          session: mockSession,
          auth: mockAuth,
          status: createElement('span', null, 'Online'),
          onSessionChange: () => undefined
        },
        createElement('p', null, 'Overview content')
      )
    );
    assert.ok(html.includes('<aside'));
    assert.ok(html.includes('Overview'));
    assert.ok(html.includes('dev@example.com'));
    assert.ok(html.includes('Online'));
    assert.ok(html.includes('Sign out'));
    assert.ok(html.includes('Overview content'));
  });
});
