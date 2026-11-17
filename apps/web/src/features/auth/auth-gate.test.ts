import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { createSignal } from '../../shared/signal.ts';
import { act, render, screen, userEvent, waitFor } from '../../shared/testing-dom.ts';
import { AuthGate } from './auth-gate.tsx';
import type { AuthClient, AuthSession } from './client.ts';

const session: AuthSession = {
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
};

const fakeAuth = (over: Partial<AuthClient> = {}) => {
  const expired = createSignal();
  const calls: string[] = [];
  const auth: AuthClient = {
    signIn: async (email, password) => {
      calls.push(`signIn ${email} ${password}`);
      return session;
    },
    signOut: async () => {
      calls.push('signOut');
    },
    getMe: async () => {
      calls.push('getMe');
      return session;
    },
    onExpired: expired.subscribe,
    previewInvitation: () => new Promise(() => undefined),
    acceptInvitation: () => new Promise(() => undefined),
    setPassword: async () => undefined,
    ...over
  };
  return { auth, calls, expire: () => act(() => expired.emit()) };
};

const show = (auth: AuthClient) =>
  render(
    createElement(AuthGate, {
      auth,
      children: (s: AuthSession, signOut: () => void) =>
        createElement('button', { type: 'button', onClick: signOut }, `Sign out ${s.user.email}`)
    })
  );

const workspace = () => screen.findByRole('button', { name: 'Sign out dev@example.com' });

const signInForm = () => screen.findByRole('button', { name: 'Sign In' });

describe('AuthGate', () => {
  it('shows nothing while the session check is pending', () => {
    const { auth } = fakeAuth({ getMe: () => new Promise(() => undefined) });
    const { container } = show(auth);
    assert.equal(container.innerHTML, '');
  });

  it('opens the workspace for a signed-in user', async () => {
    const { auth, calls } = fakeAuth();
    show(auth);
    assert.ok(await workspace());
    assert.deepEqual(calls, ['getMe']);
  });

  it('asks a signed-out user to sign in', async () => {
    const { auth } = fakeAuth({ getMe: async () => null });
    show(auth);
    assert.ok(await signInForm());
    assert.ok(screen.getByRole('main'));
    assert.ok(screen.getByText('Sign In to Your Account'));
  });

  it('asks to sign in when the session check fails', async () => {
    const { auth } = fakeAuth({
      getMe: async () => {
        throw new Error('offline');
      }
    });
    show(auth);
    assert.ok(await signInForm());
    assert.ok(!screen.queryByRole('button', { name: /Sign out/ }));
  });

  it('opens the workspace once the user signs in', async () => {
    const { auth, calls } = fakeAuth({ getMe: async () => null });
    show(auth);
    await signInForm();
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Email' }), 'dev@example.com');
    await user.type(screen.getByLabelText(/^Password/), 'P@ssw0rd123');
    await user.click(screen.getByRole('button', { name: 'Sign In' }));
    assert.ok(await workspace());
    assert.deepEqual(calls, ['signIn dev@example.com P@ssw0rd123']);
  });

  it('returns to sign-in when the session expires', async () => {
    const { auth, expire } = fakeAuth();
    show(auth);
    await workspace();
    await expire();
    assert.ok(await signInForm());
    assert.ok(!screen.queryByRole('button', { name: /Sign out/ }));
  });

  it('signs out and returns to sign-in', async () => {
    const { auth, calls } = fakeAuth();
    show(auth);
    await userEvent.setup().click(await workspace());
    assert.ok(await signInForm());
    assert.deepEqual(calls, ['getMe', 'signOut']);
  });

  it('signs out locally even when the sign-out request fails', async () => {
    let rejected = 0;
    const { auth } = fakeAuth({
      signOut: async () => {
        rejected++;
        throw new Error('offline');
      }
    });
    show(auth);
    await userEvent.setup().click(await workspace());
    assert.ok(await signInForm());
    assert.equal(rejected, 1);
  });

  it('keeps the workspace until the sign-out request settles', async () => {
    let settle: () => void = () => undefined;
    const { auth } = fakeAuth({
      signOut: () =>
        new Promise<void>((resolve) => {
          settle = resolve;
        })
    });
    show(auth);
    await userEvent.setup().click(await workspace());
    assert.ok(screen.getByRole('button', { name: 'Sign out dev@example.com' }));
    await act(async () => settle());
    await waitFor(() => assert.ok(screen.getByRole('button', { name: 'Sign In' })));
  });
});
