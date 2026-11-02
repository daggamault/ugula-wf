import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ActivityIcon, ListTodoIcon } from 'lucide-react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Shell } from './shell.tsx';

describe('Shell', () => {
  it('renders grouped side navigation, user footer, and main content area', () => {
    const html = renderToStaticMarkup(
      createElement(
        Shell,
        {
          path: '/runs',
          navItems: [
            {
              id: 'runs',
              label: 'Runs',
              href: '/runs',
              icon: ActivityIcon,
              group: 'Automation',
              active: true
            },
            {
              id: 'tasks',
              label: 'Tasks',
              href: '/tasks',
              icon: ListTodoIcon,
              group: 'Work',
              active: false,
              badge: 7
            }
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
    assert.ok(html.includes('href="/runs"'));
    assert.ok(html.includes('Automation'));
    assert.ok(html.includes('Work'));
    assert.ok(html.includes('dev@example.com'));
    assert.ok(html.includes('Online'));
    assert.ok(html.includes('aria-label="Sign out"'));
    assert.ok(html.includes('aria-label="Open menu"'));
    assert.ok(html.includes('<main'));
    assert.ok(html.includes('Workspace content'));
    assert.ok(html.includes('>7<span class="sr-only"> open</span>'));
  });
});
