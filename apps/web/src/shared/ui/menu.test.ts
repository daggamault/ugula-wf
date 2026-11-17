import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DollarSignIcon, PlayIcon, UsersIcon } from 'lucide-react';
import { createElement } from 'react';
import { act, render, screen, userEvent, within } from '../testing-dom.ts';
import { Menu, type MenuGroup } from './menu.tsx';

const showMenu = ({ isPending = false } = {}) => {
  const selected: string[] = [];
  const groups: MenuGroup[] = [
    {
      label: 'Change the Claim',
      items: [
        {
          label: 'Post Payment',
          description: 'A payment by mail.',
          icon: DollarSignIcon,
          onSelect: () => selected.push('payment')
        },
        {
          label: 'Change Payers',
          description: 'Reorder payers.',
          icon: UsersIcon,
          disabledReason: 'This claim is closed.',
          onSelect: () => selected.push('payers')
        }
      ]
    },
    {
      label: 'Review',
      items: [
        {
          label: 'Audit',
          description: 'Check the claim.',
          icon: PlayIcon,
          onSelect: () => selected.push('audit')
        }
      ]
    }
  ];
  render(createElement(Menu, { label: 'Start Task', icon: PlayIcon, isPending, groups }));
  const trigger = screen.getByRole('button', { name: 'Start Task' });
  const panel = screen.getByRole('menu', { name: 'Start Task', hidden: true });
  const item = (name: string) => within(panel).getByRole('menuitem', { name, hidden: true });
  const open = () => act(() => panel.showPopover());
  return { selected, trigger, panel, item, open, user: userEvent.setup() };
};

describe('Menu', () => {
  it('is a button that pops up the menu panel', () => {
    const { trigger, panel } = showMenu();
    assert.equal(trigger.getAttribute('type'), 'button');
    assert.equal(trigger.getAttribute('aria-haspopup'), 'menu');
    assert.equal(trigger.getAttribute('popovertarget'), panel.id);
    assert.equal(panel.getAttribute('popover'), 'auto');
    assert.equal(panel.matches(':popover-open'), false);
  });

  it('gives each menu its own panel, with an id usable as a CSS anchor name', () => {
    for (const label of ['Start Task', 'Run Report']) {
      render(createElement(Menu, { label, icon: PlayIcon, groups: [] }));
    }
    const ids = screen.getAllByRole('menu', { hidden: true }).map((menu) => menu.id);
    assert.equal(new Set(ids).size, 2);
    for (const id of ids) assert.match(id, /^menu-[\w-]+$/);
    assert.equal(
      screen.getByRole('button', { name: 'Run Report' }).getAttribute('popovertarget'),
      ids[1]
    );
  });

  it('groups items under named groups', () => {
    const { panel } = showMenu();
    const groups = within(panel).getAllByRole('group', { hidden: true });
    assert.deepEqual(
      groups.map((g) => within(g).getAllByRole('menuitem', { hidden: true }).length),
      [2, 1]
    );
    assert.deepEqual(
      groups.map((g) => g.querySelector('legend')?.textContent),
      ['Change the Claim', 'Review']
    );
  });

  it('labels each item with what it does under a decorative icon', () => {
    const { item } = showMenu();
    const payment = item('Post Payment A payment by mail.');
    assert.equal(payment.getAttribute('type'), 'button');
    assert.equal(payment.getAttribute('aria-disabled'), null);
    assert.equal(payment.querySelector('svg')?.getAttribute('aria-hidden'), 'true');
  });

  it('says why a blocked item cannot be chosen instead of what it does', () => {
    const { item, panel } = showMenu();
    const payers = item('Change Payers This claim is closed.');
    assert.equal(payers.getAttribute('aria-disabled'), 'true');
    assert.ok(!within(panel).queryByText('Reorder payers.'));
  });

  it('closes and runs an item when chosen', async () => {
    const { item, panel, open, selected, user } = showMenu();
    open();
    await user.click(item('Audit Check the claim.'));
    assert.deepEqual(selected, ['audit']);
    assert.equal(panel.matches(':popover-open'), false);
  });

  it('stays open and runs nothing when a blocked item is clicked', async () => {
    const { item, panel, open, selected, user } = showMenu();
    open();
    await user.click(item('Change Payers This claim is closed.'));
    assert.deepEqual(selected, []);
    assert.equal(panel.matches(':popover-open'), true);
  });

  it('runs an item from the keyboard', async () => {
    const { item, open, selected, user } = showMenu();
    open();
    act(() => item('Post Payment A payment by mail.').focus());
    await user.keyboard('{Enter}');
    assert.deepEqual(selected, ['payment']);
  });

  it('is enabled and not busy while idle', () => {
    const { trigger } = showMenu();
    assert.equal(trigger.hasAttribute('disabled'), false);
    assert.equal(trigger.getAttribute('aria-busy'), null);
  });

  it('locks the trigger and shows it busy while an item is starting', () => {
    const { trigger } = showMenu({ isPending: true });
    assert.equal(trigger.hasAttribute('disabled'), true);
    assert.equal(trigger.getAttribute('aria-busy'), 'true');
    assert.equal(trigger.textContent, 'Start Task');
  });
});
