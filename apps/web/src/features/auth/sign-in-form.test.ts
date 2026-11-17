import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { render, screen, userEvent, within } from '../../shared/testing-dom.ts';
import type { AuthClient } from './client.ts';
import { SignInForm, signInErrorOf } from './sign-in-form.tsx';

const mockAuth: AuthClient = {
  signIn: async () => ({
    user: {
      id: 'u-1',
      email: 'dev@example.com',
      firstName: 'Dev',
      lastName: 'User',
      type: 'organization',
      isOwner: false,
      organizationId: 'o-1',
      organizationName: 'Acme'
    },
    sseUrl: 'http://localhost:3002'
  }),
  signOut: async () => undefined,
  getMe: async () => null,
  onExpired: () => () => undefined,
  previewInvitation: () => new Promise(() => undefined),
  acceptInvitation: () => new Promise(() => undefined),
  setPassword: async () => undefined
};

describe('SignInForm', () => {
  it('names its card and labels the email and password fields for autofill', () => {
    render(createElement(SignInForm, { auth: mockAuth, onSuccess: () => undefined }));
    const card = screen.getByRole('region', { name: 'Sign In to Your Account' });
    const email = within(card).getByLabelText(/^Email/) as HTMLInputElement;
    const password = within(card).getByLabelText(/^Password/) as HTMLInputElement;
    assert.deepEqual(
      [email.type, email.autocomplete, password.type, password.autocomplete],
      ['email', 'email', 'password', 'current-password']
    );
    assert.equal(
      within(card).getByRole('button', { name: 'Sign In' }).getAttribute('type'),
      'submit'
    );
    assert.ok(!screen.queryByRole('alert'));
  });

  it('signs in with the typed email and password', async () => {
    const calls: [string, string][] = [];
    const signedIn: unknown[] = [];
    const session = await mockAuth.signIn('', '');
    const auth = {
      ...mockAuth,
      signIn: async (email: string, password: string) => {
        calls.push([email, password]);
        return session;
      }
    };
    render(createElement(SignInForm, { auth, onSuccess: (s) => signedIn.push(s) }));
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Email' }), 'dev@example.com');
    await user.type(screen.getByLabelText(/^Password/), 'secret');
    await user.click(screen.getByRole('button', { name: 'Sign In' }));
    assert.deepEqual(calls, [['dev@example.com', 'secret']]);
    assert.deepEqual(signedIn, [session]);
    assert.ok(!screen.queryByRole('alert'));
  });

  it('shows why sign-in failed and lets the user try again', async () => {
    const auth = {
      ...mockAuth,
      signIn: async () => {
        throw new Error('Invalid email or password');
      }
    };
    const signedIn: unknown[] = [];
    render(createElement(SignInForm, { auth, onSuccess: (s) => signedIn.push(s) }));
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Email' }), 'dev@example.com');
    await user.type(screen.getByLabelText(/^Password/), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Sign In' }));
    assert.equal((await screen.findByRole('alert')).textContent, 'Invalid email or password');
    assert.deepEqual(signedIn, []);
    assert.equal(
      (screen.getByRole('textbox', { name: 'Email' }) as HTMLInputElement).disabled,
      false
    );
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
