import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AuthClient } from './client.ts';
import { SignInForm, signInErrorOf } from './sign-in-form.tsx';

const mockAuth: AuthClient = {
  signIn: async () => ({
    user: { id: 'u-1', agencyId: 't-1', email: 'dev@example.com' },
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
    assert.ok(html.includes('Sign In to Your Account'));
    assert.ok(html.includes('for="email"') && html.includes('>Email<'));
    assert.ok(html.includes('for="password"') && html.includes('>Password<'));
    assert.ok(html.includes('type="email"') && html.includes('autoComplete="email"'));
    assert.ok(html.includes('type="password"') && html.includes('autoComplete="current-password"'));
    assert.ok(html.includes('type="submit"') && html.includes('Sign In</span></button>'));
    assert.ok(!html.includes('role="alert"'));
  });
});

describe('signInErrorOf', () => {
  const limited = (body: Record<string, unknown>) =>
    Object.assign(new Error('Too many attempts'), { status: 429, body });

  it('says how long to wait after too many attempts', () => {
    assert.equal(
      signInErrorOf(limited({ retryAfter: 600 })),
      'Too many sign-in attempts. Try again in 10 minutes.'
    );
    assert.equal(
      signInErrorOf(limited({ retryAfter: 30 })),
      'Too many sign-in attempts. Try again in 1 minute.'
    );
    assert.equal(
      signInErrorOf(limited({})),
      'Too many sign-in attempts. Try again in a few minutes.'
    );
    assert.equal(
      signInErrorOf(limited({ retryAfter: 'soon' })),
      'Too many sign-in attempts. Try again in a few minutes.'
    );
  });

  it('passes other failures through', () => {
    assert.equal(
      signInErrorOf(new Error('Invalid email or password')),
      'Invalid email or password'
    );
  });
});
