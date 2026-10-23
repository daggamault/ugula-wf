import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AuthClient } from './client.ts';
import { SignInForm } from './sign-in-form.tsx';

const mockAuth: AuthClient = {
  signIn: async () => ({
    user: { id: 'u-1', tenantId: 't-1', email: 'dev@example.com' },
    sseUrl: 'http://localhost:3002'
  }),
  signOut: async () => undefined,
  getMe: async () => null,
  onExpired: () => () => undefined
};

describe('SignInForm', () => {
  it('renders accessible sign-in form fields and submit button', () => {
    const html = renderToStaticMarkup(
      createElement(SignInForm, { auth: mockAuth, onSuccess: () => undefined })
    );
    assert.ok(html.includes('Sign in to your account.'));
    assert.ok(html.includes('type="email"'));
    assert.ok(html.includes('type="password"'));
    assert.ok(html.includes('type="submit"'));
  });
});
