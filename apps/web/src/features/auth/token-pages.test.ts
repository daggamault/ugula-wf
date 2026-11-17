import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { render, screen, userEvent } from '../../shared/testing-dom.ts';
import type { AuthClient } from './client.ts';
import { InvitationPage, PasswordPage, passwordProblem, pathWithoutToken } from './token-pages.tsx';

const auth = {
  previewInvitation: () => new Promise(() => undefined),
  setPassword: async () => undefined
} as unknown as AuthClient;

describe('passwordProblem', () => {
  it('asks for a long enough password typed the same twice', () => {
    assert.equal(passwordProblem('short', 'short'), 'Use at least 12 characters.');
    assert.equal(
      passwordProblem('long enough pw', 'long enough px'),
      'The passwords do not match.'
    );
    assert.equal(passwordProblem('long enough pw', 'long enough pw'), null);
  });
});

describe('pathWithoutToken', () => {
  it('drops the one-time token from the address and keeps the rest', () => {
    assert.equal(
      pathWithoutToken({ pathname: '/invitation', search: '?token=abc' }),
      '/invitation'
    );
    assert.equal(
      pathWithoutToken({ pathname: '/password', search: '?token=abc&x=1' }),
      '/password?x=1'
    );
    assert.equal(pathWithoutToken({ pathname: '/password', search: '' }), null);
  });
});

const PASSWORD = 'long enough pw';

const invitation = {
  email: 'new@example.com',
  firstName: 'Nia',
  lastName: 'Lee',
  agencyName: 'North EMS',
  organizationName: 'Acme',
  roleName: 'Biller',
  hasAccount: false
};

describe('InvitationPage', () => {
  const show = (over: Partial<AuthClient> = {}, token = 't1') => {
    const accepted: [string, string][] = [];
    const client = {
      ...auth,
      previewInvitation: async () => invitation,
      acceptInvitation: async (t: string, p: string) => {
        accepted.push([t, p]);
        return new Promise<never>(() => undefined);
      },
      ...over
    } as AuthClient;
    render(createElement(InvitationPage, { auth: client, token }));
    return accepted;
  };

  it('drops the token from the address once the page has it', async () => {
    window.history.replaceState(null, '', '/invitation?token=t1&agency=a1');
    const asked: string[] = [];
    show({
      previewInvitation: async (t) => {
        asked.push(t);
        return invitation;
      }
    });
    await screen.findByRole('region', { name: 'Join North EMS' });
    assert.equal(`${window.location.pathname}${window.location.search}`, '/invitation?agency=a1');
    assert.deepEqual(asked, ['t1']);
  });

  it('asks a new user to choose a password twice and accepts with it', async () => {
    const accepted = show();
    await screen.findByText('Join North EMS');
    assert.ok(screen.getByText(/Nia, you were invited to Acme as Biller/));
    assert.ok(screen.getByText(/Choose a password for new@example.com/));
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/^Password/), PASSWORD);
    await user.type(screen.getByLabelText(/^Confirm Password/), 'long enough px');
    await user.click(screen.getByRole('button', { name: 'Accept Invitation' }));
    assert.equal(screen.getByRole('alert').textContent, 'The passwords do not match.');
    assert.deepEqual(accepted, []);
    await user.clear(screen.getByLabelText(/^Confirm Password/));
    await user.type(screen.getByLabelText(/^Confirm Password/), PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Accept Invitation' }));
    assert.deepEqual(accepted, [['t1', PASSWORD]]);
    assert.ok(!screen.queryByRole('alert'));
    assert.equal(screen.getByLabelText(/^Password/).matches(':disabled'), true);
  });

  it('asks an existing user only for their current password', async () => {
    const accepted = show({ previewInvitation: async () => ({ ...invitation, hasAccount: true }) });
    await screen.findByText('Join North EMS');
    assert.ok(screen.getByText(/Enter the password for new@example.com to accept/));
    assert.ok(!screen.queryByLabelText(/^Confirm Password/));
    const password = screen.getByLabelText(/^Password/) as HTMLInputElement;
    assert.equal(password.autocomplete, 'current-password');
    const user = userEvent.setup();
    await user.type(password, 'short');
    await user.click(screen.getByRole('button', { name: 'Accept Invitation' }));
    assert.deepEqual(accepted, [['t1', 'short']]);
  });

  it('says why the invitation could not be accepted', async () => {
    show({ acceptInvitation: () => Promise.reject(new Error('This invitation was revoked')) });
    await screen.findByText('Join North EMS');
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/^Password/), PASSWORD);
    await user.type(screen.getByLabelText(/^Confirm Password/), PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Accept Invitation' }));
    assert.equal((await screen.findByRole('alert')).textContent, 'This invitation was revoked');
    assert.equal(screen.getByLabelText(/^Password/).matches(':disabled'), false);
  });

  it('says why the link cannot be used', async () => {
    show({ previewInvitation: () => Promise.reject(new Error('This link has expired.')) });
    assert.equal((await screen.findByRole('alert')).textContent, 'This link has expired.');
    assert.ok(screen.getByRole('region', { name: 'Invitation' }));
    assert.ok(!screen.queryByRole('button', { name: 'Accept Invitation' }));
  });
});

describe('PasswordPage', () => {
  const show = (setPassword: AuthClient['setPassword']) =>
    render(createElement(PasswordPage, { auth: { ...auth, setPassword }, token: 't1' }));

  it('names its card by what it does', () => {
    show(async () => undefined);
    assert.ok(screen.getByRole('region', { name: 'Set Your Password' }));
  });

  it('refuses a short password without sending it', async () => {
    const sent: string[] = [];
    show(async (_t, p) => {
      sent.push(p);
    });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/^New Password/), 'short');
    await user.type(screen.getByLabelText(/^Confirm Password/), 'short');
    await user.click(screen.getByRole('button', { name: 'Set Password' }));
    assert.equal(screen.getByRole('alert').textContent, 'Use at least 12 characters.');
    assert.deepEqual(sent, []);
  });

  it('sets the password from the link and then offers to sign in', async () => {
    const sent: [string, string][] = [];
    show(async (t, p) => {
      sent.push([t, p]);
    });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/^New Password/), PASSWORD);
    await user.type(screen.getByLabelText(/^Confirm Password/), PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Set Password' }));
    assert.equal(
      (await screen.findByRole('status')).textContent,
      'Your password is set. Sign in with it now.'
    );
    assert.deepEqual(sent, [['t1', PASSWORD]]);
    window.history.replaceState(null, '', '/password?x=1');
    await user.click(screen.getByRole('button', { name: 'Sign In' }));
    assert.equal(`${window.location.pathname}${window.location.search}`, '/');
  });

  it('says why the password could not be set and lets the user try again', async () => {
    show(() => Promise.reject(new Error('This link has expired.')));
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/^New Password/), PASSWORD);
    await user.type(screen.getByLabelText(/^Confirm Password/), PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Set Password' }));
    assert.equal((await screen.findByRole('alert')).textContent, 'This link has expired.');
    assert.equal(screen.getByLabelText(/^New Password/).matches(':disabled'), false);
  });
});
