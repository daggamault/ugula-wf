import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AuthClient } from './client.ts';
import { InvitationPage, PasswordPage, passwordProblem } from './token-pages.tsx';

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

describe('token pages', () => {
  it('waits for the invitation before showing it', () => {
    const html = renderToStaticMarkup(createElement(InvitationPage, { auth, token: 't1' }));
    assert.ok(html.includes('aria-label="Loading"'));
  });

  it('asks for a new password twice', () => {
    const html = renderToStaticMarkup(createElement(PasswordPage, { auth, token: 't1' }));
    assert.ok(html.includes('Set Your Password'));
    assert.ok(html.includes('for="new-password"') && html.includes('for="confirm-password"'));
    assert.ok(html.includes('autoComplete="new-password"'));
    assert.ok(html.includes('Set Password</span></button>'));
  });
});
