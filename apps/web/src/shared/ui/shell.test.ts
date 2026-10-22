import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Shell } from './shell.tsx';

describe('Shell', () => {
  it('renders side navigation, user footer, and main content area', () => {
    const html = renderToStaticMarkup(
      createElement(
        Shell,
        {
          title: 'Overview',
          navItems: [
            { id: 'overview', label: 'Overview', active: true },
            { id: 'other', label: 'Other', active: false }
          ],
          userEmail: 'dev@example.com',
          status: createElement('span', null, 'Online'),
          onSignOut: () => undefined
        },
        createElement('section', null, 'Workspace content')
      )
    );

    assert.ok(html.includes('<aside'));
    assert.ok(html.includes('aria-label="Primary"'));
    assert.ok(html.includes('aria-current="page"'));
    assert.ok(html.includes('dev@example.com'));
    assert.ok(html.includes('Online'));
    assert.ok(html.includes('Sign out'));
    assert.ok(html.includes('<main'));
    assert.ok(html.includes('Overview'));
    assert.ok(html.includes('Workspace content'));
  });
});
