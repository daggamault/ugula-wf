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
    assert.ok(html.includes('aria-label="Sign Out"'));
    assert.ok(html.includes('aria-label="Open Menu"'));
    const [, menu] = html.match(/aria-expanded="false" aria-controls="([^"]+)"/) ?? [];
    assert.ok(menu && html.includes(`id="${menu}" inert=""`));
    assert.equal(html.match(/aria-label="Switch to Dark Mode"/g)?.length, 2);
    assert.ok(html.includes('>d</span>'));
    assert.ok(html.includes('<main'));
    assert.ok(html.includes('Workspace content'));
    assert.ok(html.includes('>7<span class="sr-only"> open</span>'));
  });

  it('highlights the title of the group containing the active link', () => {
    const html = renderToStaticMarkup(
      createElement(Shell, {
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
            active: false
          }
        ],
        userEmail: 'dev@example.com',
        onSignOut: () => undefined
      })
    );

    const titleOf = (group: string) => {
      const match = html.match(new RegExp(`<p class="([^"]*)">${group}</p>`));
      assert.ok(match, `missing ${group} title`);
      return (match[1] ?? '').split(' ');
    };

    const automation = titleOf('Automation');
    assert.ok(automation.includes('text-surface-fg'));
    assert.ok(automation.includes('font-bold'));
    assert.ok(!automation.includes('text-surface-fg-muted'));

    const work = titleOf('Work');
    assert.ok(work.includes('text-surface-fg-muted'));
    assert.ok(work.includes('font-semibold'));
    assert.ok(!work.includes('font-bold'));
  });
});
