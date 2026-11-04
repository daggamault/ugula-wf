import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { UsersClient } from './client.ts';
import { UserPage } from './user-page.tsx';

describe('UserPage', () => {
  it('waits for the user and the roles', () => {
    const pending = () => new Promise(() => undefined);
    const html = renderToStaticMarkup(
      createElement(UserPage, {
        client: { user: pending, roles: pending } as unknown as UsersClient,
        userId: 'u1',
        back: '/users'
      })
    );
    assert.ok(html.includes('aria-label="Loading"'));
  });
});
