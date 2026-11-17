import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { ActivityIcon, ListTodoIcon, UsersIcon } from 'lucide-react';
import { createElement } from 'react';
import { act, render, screen, userEvent, within } from '../testing-dom.ts';
import { Shell } from './shell.tsx';

type Props = Parameters<typeof Shell>[0];

const OPEN_GROUPS_KEY = 'ugula.nav.open-groups';

const runs = {
  id: 'runs',
  label: 'Runs',
  href: '/runs',
  icon: ActivityIcon,
  group: 'Automation',
  active: true
};
const tasks = {
  id: 'tasks',
  label: 'Tasks',
  href: '/tasks',
  icon: ListTodoIcon,
  group: 'Work',
  active: false
};
const users = {
  id: 'users',
  label: 'Users',
  href: '/users',
  icon: UsersIcon,
  group: 'Admin',
  active: false
};
const claims = { id: 'claims', label: 'Claims', href: '/claims', icon: ListTodoIcon };

const show = (over: Partial<Props> = {}) => {
  const signOuts: number[] = [];
  const props: Props = {
    path: '/runs',
    navItems: [runs, tasks],
    userEmail: 'dev@example.com',
    onSignOut: () => signOuts.push(1),
    ...over
  };
  const view = render(
    createElement(Shell, props, createElement('section', null, 'Workspace content'))
  );
  const rerender = (next: Partial<Props>) =>
    view.rerender(
      createElement(
        Shell,
        { ...props, ...next },
        createElement('section', null, 'Workspace content')
      )
    );
  return { signOuts, rerender, user: userEvent.setup() };
};

const sidebar = () => screen.getByRole('complementary');
const topBar = () => screen.getByRole('banner');
const sideNav = () => within(sidebar()).getByRole('navigation', { name: 'Primary' });
const menuButton = () => within(topBar()).getByRole('button', { name: /^(Open|Close) Menu$/ });
const menuPanel = () => document.getElementById(menuButton().getAttribute('aria-controls') ?? '');
const groupToggle = (group: string) => within(sideNav()).getByRole('button', { name: group });
const listOf = (toggle: HTMLElement) =>
  document.getElementById(toggle.getAttribute('aria-controls') ?? '');

afterEach(() => localStorage.clear());

describe('Shell', () => {
  it('shows the page content in the main landmark', () => {
    show();
    assert.equal(screen.getByRole('main').textContent, 'Workspace content');
  });

  it('lists the navigation links under their group titles', () => {
    show();
    const nav = sideNav();
    assert.deepEqual(
      within(nav)
        .getAllByRole('link')
        .map((a) => [a.textContent, a.getAttribute('href')]),
      [
        ['Runs', '/runs'],
        ['Tasks', '/tasks']
      ]
    );
    assert.equal(within(nav).getByText('Automation').tagName, 'P');
    assert.equal(within(nav).getByText('Work').tagName, 'P');
  });

  it('marks only the active link as the current page', () => {
    show();
    assert.deepEqual(
      within(sideNav())
        .getAllByRole('link')
        .map((a) => a.getAttribute('aria-current')),
      ['page', null]
    );
  });

  it('counts open items on a link for screen readers too', () => {
    show({ navItems: [runs, { ...tasks, badge: 7 }] });
    assert.equal(
      within(sideNav()).getByRole('link', { name: 'Tasks 7 open' }).getAttribute('href'),
      '/tasks'
    );
  });

  it('navigates in place when a link is followed', async () => {
    const { user } = show();
    await user.click(within(sideNav()).getByRole('link', { name: 'Tasks' }));
    assert.equal(window.location.pathname, '/tasks');
  });

  it('brightens the title of the group holding the active link', () => {
    show();
    const title = (group: string) => within(sideNav()).getByText(group).classList;
    assert.equal(title('Automation').contains('text-surface-fg'), true);
    assert.equal(title('Automation').contains('text-surface-fg-muted'), false);
    assert.equal(title('Work').contains('text-surface-fg-muted'), true);
  });

  it('lists untitled links without a group title', () => {
    show({
      path: '/claims',
      navItems: [
        { ...claims, active: true },
        { ...runs, active: false }
      ]
    });
    const lists = within(sideNav()).getAllByRole('list');
    assert.deepEqual(
      lists.map((l) =>
        within(l)
          .getAllByRole('link')
          .map((a) => a.textContent)
      ),
      [['Claims'], ['Runs']]
    );
    assert.equal(lists[0]?.previousElementSibling, null);
  });

  it('puts the agency picker above the navigation behind a divider', () => {
    show({ agencyPicker: createElement('span', null, 'Agency') });
    const side = sidebar();
    const picker = within(side).getByText('Agency');
    const divider = within(side).getByRole('separator');
    assert.equal(picker.parentElement?.nextElementSibling, divider);
    assert.equal(divider.nextElementSibling, sideNav());
  });

  it('shows the signed-in user with their status and initial', () => {
    show({ status: createElement('span', null, 'Online') });
    const side = sidebar();
    assert.equal(within(side).getByText('Online').tagName, 'SPAN');
    assert.equal(within(side).getByTitle('dev@example.com').textContent, 'dev@example.com');
    const initial = within(side).getByText('d');
    assert.equal(initial.getAttribute('aria-hidden'), 'true');
  });

  it('signs out from the user footer', async () => {
    const { signOuts, user } = show();
    await user.click(within(sidebar()).getByRole('button', { name: 'Sign Out' }));
    assert.deepEqual(signOuts, [1]);
  });

  it('offers the tools and the theme toggle in both headers', () => {
    show({ tools: createElement('button', { type: 'button' }, 'Help') });
    for (const region of [sidebar(), topBar()]) {
      assert.equal(within(region).getAllByRole('button', { name: 'Help' }).length, 1);
      assert.equal(
        within(region).getAllByRole('button', { name: 'Switch to Dark Mode' }).length,
        1
      );
    }
  });

  it('scrolls the content back to the top when the page changes', (t) => {
    const scrolls: unknown[] = [];
    t.mock.method(HTMLElement.prototype, 'scrollTo', (options: unknown) => scrolls.push(options));
    const { rerender } = show();
    assert.deepEqual(scrolls, [{ top: 0 }]);
    rerender({});
    assert.deepEqual(scrolls, [{ top: 0 }]);
    rerender({ path: '/tasks' });
    assert.deepEqual(scrolls, [{ top: 0 }, { top: 0 }]);
  });
});

describe('Shell phone menu', () => {
  it('starts with the menu closed and out of reach', () => {
    show();
    const button = menuButton();
    assert.equal(button.getAttribute('aria-label'), 'Open Menu');
    assert.equal(button.getAttribute('aria-expanded'), 'false');
    assert.equal(menuPanel()?.hasAttribute('inert'), true);
  });

  it('opens and closes the menu from its button', async () => {
    const { user } = show();
    await user.click(menuButton());
    assert.equal(menuButton().getAttribute('aria-label'), 'Close Menu');
    assert.equal(menuButton().getAttribute('aria-expanded'), 'true');
    assert.equal(menuPanel()?.hasAttribute('inert'), false);
    assert.equal(
      within(menuPanel() as HTMLElement).getByRole('navigation', { name: 'Primary' }).tagName,
      'NAV'
    );
    await user.click(menuButton());
    assert.equal(menuButton().getAttribute('aria-expanded'), 'false');
    assert.equal(menuPanel()?.hasAttribute('inert'), true);
  });

  it('closes the menu on Escape', async () => {
    const { user } = show();
    await user.click(menuButton());
    await user.keyboard('{Escape}');
    assert.equal(menuButton().getAttribute('aria-expanded'), 'false');
  });

  it('closes the menu on a press outside the header but not inside it', async () => {
    const { user } = show();
    await user.click(menuButton());
    await user.pointer({ keys: '[MouseLeft]', target: within(topBar()).getByText('ugula') });
    assert.equal(menuButton().getAttribute('aria-expanded'), 'true');
    await user.pointer({ keys: '[MouseLeft]', target: screen.getByRole('main') });
    assert.equal(menuButton().getAttribute('aria-expanded'), 'false');
  });

  it('closes the menu once the page changes', async () => {
    const { user, rerender } = show();
    await user.click(menuButton());
    act(() => rerender({ path: '/tasks' }));
    assert.equal(menuButton().getAttribute('aria-expanded'), 'false');
    assert.equal(menuPanel()?.hasAttribute('inert'), true);
  });
});

describe('Shell collapsible groups', () => {
  const showGroups = (over: Partial<Props> = {}) =>
    show({ navItems: [tasks, runs, users], collapsibleGroups: ['Automation', 'Admin'], ...over });

  it('turns only the collapsible group titles into toggles for their lists', () => {
    showGroups();
    for (const group of ['Automation', 'Admin']) {
      const list = listOf(groupToggle(group));
      assert.equal(list?.querySelector('ul')?.tagName, 'UL', group);
    }
    assert.ok(!within(sideNav()).queryByRole('button', { name: 'Work' }));
    assert.equal(within(sideNav()).getByText('Work').tagName, 'P');
  });

  it('opens the group holding the active page and keeps the others closed', () => {
    showGroups();
    assert.equal(groupToggle('Automation').getAttribute('aria-expanded'), 'true');
    assert.equal(listOf(groupToggle('Automation'))?.hasAttribute('inert'), false);
    assert.equal(groupToggle('Admin').getAttribute('aria-expanded'), 'false');
    assert.equal(listOf(groupToggle('Admin'))?.hasAttribute('inert'), true);
  });

  it('toggles a group and remembers which groups are open', async () => {
    const { user } = showGroups();
    await user.click(groupToggle('Admin'));
    assert.equal(groupToggle('Admin').getAttribute('aria-expanded'), 'true');
    assert.equal(listOf(groupToggle('Admin'))?.hasAttribute('inert'), false);
    assert.deepEqual(JSON.parse(localStorage.getItem(OPEN_GROUPS_KEY) ?? ''), ['Admin']);
    await user.click(groupToggle('Admin'));
    assert.equal(groupToggle('Admin').getAttribute('aria-expanded'), 'false');
    assert.deepEqual(JSON.parse(localStorage.getItem(OPEN_GROUPS_KEY) ?? ''), []);
  });

  it('reopens groups remembered from before', () => {
    localStorage.setItem(OPEN_GROUPS_KEY, JSON.stringify(['Admin', 7]));
    showGroups();
    assert.equal(groupToggle('Admin').getAttribute('aria-expanded'), 'true');
  });

  it('ignores a remembered value that is not a list', () => {
    localStorage.setItem(OPEN_GROUPS_KEY, '{broken');
    showGroups();
    assert.equal(groupToggle('Admin').getAttribute('aria-expanded'), 'false');
  });

  it('opens a closed group when the active page moves into it', () => {
    const { rerender } = showGroups();
    rerender({
      path: '/users',
      navItems: [tasks, { ...runs, active: false }, { ...users, active: true }]
    });
    assert.equal(groupToggle('Admin').getAttribute('aria-expanded'), 'true');
  });
});
