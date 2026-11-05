import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ActivityIcon, ListTodoIcon, UsersIcon } from 'lucide-react';
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
    const lists = html.match(/<ul class="[^"]*"/g) ?? [];
    assert.ok(lists.length > 0);
    for (const list of lists) assert.ok(list.split(/[\s"]/).includes('border-l'), list);
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
          },
          {
            id: 'claims',
            label: 'Claims',
            href: '/claims',
            icon: ListTodoIcon
          }
        ],
        userEmail: 'dev@example.com',
        agencyPicker: createElement('span', null, 'Agency'),
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
    assert.ok(!automation.includes('text-surface-fg-muted'));

    const work = titleOf('Work');
    assert.ok(work.includes('text-surface-fg-muted'));
    assert.deepEqual(
      [automation, work].map((t) => t.includes('font-bold') && t.includes('h-9')),
      [true, true]
    );
  });

  it('lists untitled links flat, without the child border, under a divider', () => {
    const html = renderToStaticMarkup(
      createElement(Shell, {
        path: '/claims',
        navItems: [
          { id: 'claims', label: 'Claims', href: '/claims', icon: ListTodoIcon, active: true },
          { id: 'runs', label: 'Runs', href: '/runs', icon: ActivityIcon, group: 'Automation' }
        ],
        userEmail: 'dev@example.com',
        agencyPicker: createElement('span', null, 'Agency'),
        onSignOut: () => undefined
      })
    );
    assert.equal(html.match(/<ul class="[^"]*border-l/g)?.length, 2);
    assert.equal(html.match(/<ul class="flex flex-col gap-1">/g)?.length, 2);
    assert.ok(html.includes('Agency</span></div><hr class="border-border"/>'));
    assert.ok(!/<a[^>]*aria-current="page"[^>]*before:/.test(html));
  });
});

describe('Shell collapsible groups', () => {
  const render = () =>
    renderToStaticMarkup(
      createElement(Shell, {
        path: '/runs',
        navItems: [
          {
            id: 'tasks',
            label: 'Tasks',
            href: '/tasks',
            icon: ListTodoIcon,
            group: 'Work',
            active: false
          },
          {
            id: 'runs',
            label: 'Runs',
            href: '/runs',
            icon: ActivityIcon,
            group: 'Automation',
            active: true
          },
          {
            id: 'users',
            label: 'Users',
            href: '/users',
            icon: UsersIcon,
            group: 'Admin',
            active: false
          }
        ],
        collapsibleGroups: ['Automation', 'Admin'],
        userEmail: 'dev@example.com',
        onSignOut: () => undefined
      })
    );

  const toggleOf = (html: string, group: string) => {
    const match = html.match(
      new RegExp(
        `<button type="button" aria-expanded="(true|false)" aria-controls="([^"]+)"[^>]*><span>${group}</span><svg`
      )
    );
    assert.ok(match, `missing ${group} toggle`);
    return { isOpen: match[1] === 'true', controls: match[2] ?? '' };
  };

  it('renders a toggle button with a chevron for each collapsible group', () => {
    const html = render();
    for (const group of ['Automation', 'Admin']) {
      const { controls } = toggleOf(html, group);
      assert.ok(html.includes(`id="${controls}"`), `${group} controls its list`);
      assert.doesNotMatch(html, new RegExp(`<p[^>]*>${group}</p>`));
    }
    assert.ok(html.includes('lucide-chevron-down'));
    assert.match(html, /<p class="[^"]*">Work<\/p>/);
  });

  it('opens the group holding the active page and keeps the others closed', () => {
    const html = render();
    const automation = toggleOf(html, 'Automation');
    assert.equal(automation.isOpen, true);
    assert.ok(!html.includes(`id="${automation.controls}" inert=""`));
    const admin = toggleOf(html, 'Admin');
    assert.equal(admin.isOpen, false);
    assert.ok(html.includes(`id="${admin.controls}" inert=""`));
    assert.ok(html.includes('href="/runs" aria-current="page"'));
    assert.ok(html.includes('href="/users"'));
  });
});
