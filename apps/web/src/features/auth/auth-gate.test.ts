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

const workspace = (session: AuthSession) => createElement('p', null, `Hi ${session.user.email}`);

describe('AuthGate', () => {
  it('renders nothing while the initial session check is pending', () => {
    const html = renderToStaticMarkup(
      createElement(AuthGate, { auth: mockAuth, children: workspace })
    );
    assert.equal(html, '');
  });

  it('renders the standalone sign-in page when unauthenticated', () => {
    const html = renderToStaticMarkup(
      createElement(AuthGateView, {
        ready: true,
        session: null,
        auth: mockAuth,
        onSessionChange: () => undefined,
        children: workspace
      })
    );
    assert.ok(html.includes('<main'));
    assert.ok(html.includes('Sign in to your account.'));
  });

  it('hands the session to the authenticated workspace', () => {
    const html = renderToStaticMarkup(
      createElement(AuthGateView, {
        ready: true,
        session: mockSession,
        auth: mockAuth,
        onSessionChange: () => undefined,
        children: workspace
      })
    );
    assert.equal(html, '<p>Hi dev@example.com</p>');
  });
});
