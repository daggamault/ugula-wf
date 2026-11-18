import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PencilIcon, Trash2Icon } from 'lucide-react';
import { createElement } from 'react';
import { render, screen, userEvent } from '../testing-dom.ts';
import {
  DeleteButton,
  EditLink,
  IconButton,
  IconLink,
  MoveButtons,
  OpenLink,
  RemoveButton,
  RowActions,
  RunLink
} from './icon-button.tsx';

const tooltipOf = (control: HTMLElement) =>
  control.parentElement?.querySelector('[popover]')?.textContent;

describe('IconButton', () => {
  it('names an icon-only button by its label, with a decorative icon', () => {
    render(createElement(IconButton, { label: 'Delete Fee', icon: Trash2Icon }));
    const button = screen.getByRole('button', { name: 'Delete Fee' });
    assert.equal(button.getAttribute('type'), 'button');
    assert.equal(button.querySelector('svg')?.getAttribute('aria-hidden'), 'true');
    assert.equal(button.getAttribute('aria-disabled'), null);
    assert.equal(button.getAttribute('aria-describedby'), null);
  });

  it('shows its label as the tooltip unless given a shorter one', () => {
    render(createElement(IconButton, { label: 'Delete Fee', icon: Trash2Icon }));
    render(createElement(IconButton, { label: 'Edit Fee', tooltip: 'Edit', icon: PencilIcon }));
    assert.equal(tooltipOf(screen.getByRole('button', { name: 'Delete Fee' })), 'Delete Fee');
    assert.equal(tooltipOf(screen.getByRole('button', { name: 'Edit Fee' })), 'Edit');
  });

  it('runs its click handler when enabled', async () => {
    const clicks: string[] = [];
    render(
      createElement(IconButton, {
        label: 'Edit',
        icon: PencilIcon,
        onClick: () => clicks.push('edit')
      })
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Edit' }));
    assert.deepEqual(clicks, ['edit']);
  });

  it('tints the hover of danger actions', () => {
    render(createElement(IconButton, { label: 'Delete', icon: Trash2Icon, intent: 'danger' }));
    render(createElement(IconButton, { label: 'Edit', icon: PencilIcon }));
    const hover = (name: string) =>
      [...screen.getByRole('button', { name }).classList].filter((c) =>
        c.startsWith('not-aria-disabled:hover:text-')
      );
    assert.deepEqual(hover('Delete'), ['not-aria-disabled:hover:text-danger']);
    assert.deepEqual(hover('Edit'), ['not-aria-disabled:hover:text-surface-fg']);
  });

  it('stays focusable when blocked, describes why, shows the reason as the tooltip and ignores clicks', async () => {
    const clicks: string[] = [];
    render(
      createElement(IconButton, {
        label: 'Move Up',
        tooltip: 'Up',
        icon: PencilIcon,
        disabledReason: 'First.',
        onClick: () => clicks.push('up')
      })
    );
    const button = screen.getByRole('button', { name: 'Move Up', description: 'First.' });
    assert.equal(button.getAttribute('aria-disabled'), 'true');
    assert.equal(button.hasAttribute('disabled'), false);
    assert.equal(tooltipOf(button), 'First.');
    await userEvent.setup().click(button);
    assert.deepEqual(clicks, []);
  });
});

describe('IconLink', () => {
  it('names an icon link by its label and navigates in place', async () => {
    render(createElement(IconLink, { to: '/runs', label: 'Back to Runs', icon: PencilIcon }));
    const link = screen.getByRole('link', { name: 'Back to Runs' });
    assert.equal(link.getAttribute('href'), '/runs');
    assert.equal(tooltipOf(link), 'Back to Runs');
    await userEvent.setup().click(link);
    assert.equal(window.location.pathname, '/runs');
  });

  it('passes rel through', () => {
    render(createElement(IconLink, { to: '/x', rel: 'noopener', label: 'Docs', icon: PencilIcon }));
    assert.equal(screen.getByRole('link', { name: 'Docs' }).getAttribute('rel'), 'noopener');
  });
});

describe('row actions', () => {
  it('names the row in each action label under a short tooltip', () => {
    const { container } = render(
      createElement(
        RowActions,
        null,
        createElement(OpenLink, { to: '/claims/c1', name: 'Doe, Jane' }),
        createElement(EditLink, { to: '/fees/f1', name: 'A0427' }),
        createElement(RunLink, { to: '/reports/aging', name: 'Aging' }),
        createElement(DeleteButton, { name: 'A0427', onClick: () => undefined })
      )
    );
    const actions = [...container.querySelectorAll<HTMLElement>('a, button')].map((el) => [
      el.getAttribute('aria-label'),
      el.getAttribute('href'),
      tooltipOf(el)
    ]);
    assert.deepEqual(actions, [
      ['Open Doe, Jane', '/claims/c1', 'Open'],
      ['Edit A0427', '/fees/f1', 'Edit'],
      ['Run Aging', '/reports/aging', 'Run'],
      ['Delete A0427', null, 'Delete']
    ]);
  });

  it('deletes through the delete button', async () => {
    const deleted: string[] = [];
    render(createElement(DeleteButton, { name: 'A0427', onClick: () => deleted.push('A0427') }));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Delete A0427' }));
    assert.deepEqual(deleted, ['A0427']);
  });
});

describe('RemoveButton', () => {
  it('names what it removes under a Remove tooltip', async () => {
    const removed: string[] = [];
    render(
      createElement(RemoveButton, {
        label: 'Remove Medicare',
        onClick: () => removed.push('medicare')
      })
    );
    const button = screen.getByRole('button', { name: 'Remove Medicare' });
    assert.equal(tooltipOf(button), 'Remove');
    await userEvent.setup().click(button);
    assert.deepEqual(removed, ['medicare']);
  });

  it('can be blocked with a reason', async () => {
    const removed: string[] = [];
    render(
      createElement(RemoveButton, {
        label: 'Remove Medicare',
        disabledReason: 'Closed.',
        onClick: () => removed.push('medicare')
      })
    );
    const button = screen.getByRole('button', { name: 'Remove Medicare', description: 'Closed.' });
    assert.equal(button.getAttribute('aria-disabled'), 'true');
    await userEvent.setup().click(button);
    assert.deepEqual(removed, []);
  });
});

describe('MoveButtons', () => {
  const show = (index: number, count: number, idPrefix?: string) => {
    const moved: number[] = [];
    render(
      createElement(MoveButtons, {
        name: 'I10',
        index,
        count,
        ...(idPrefix ? { idPrefix } : {}),
        onMove: (by) => moved.push(by)
      })
    );
    return {
      moved,
      up: screen.getByRole('button', { name: 'Move I10 up' }),
      down: screen.getByRole('button', { name: 'Move I10 down' }),
      user: userEvent.setup()
    };
  };

  it('moves a middle item either way', async () => {
    const { moved, up, down, user } = show(1, 3);
    assert.equal(tooltipOf(up), 'Move Up');
    assert.equal(tooltipOf(down), 'Move Down');
    await user.click(up);
    await user.click(down);
    assert.deepEqual(moved, [-1, 1]);
  });

  it('blocks moving the first item up', async () => {
    const { moved, up, down, user } = show(0, 2);
    assert.equal(up.getAttribute('aria-disabled'), 'true');
    assert.equal(tooltipOf(up), 'Already first.');
    assert.equal(down.getAttribute('aria-disabled'), null);
    await user.click(up);
    assert.deepEqual(moved, []);
  });

  it('blocks moving the last item down', async () => {
    const { moved, up, down, user } = show(1, 2);
    assert.equal(down.getAttribute('aria-disabled'), 'true');
    assert.equal(tooltipOf(down), 'Already last.');
    assert.equal(up.getAttribute('aria-disabled'), null);
    await user.click(down);
    assert.deepEqual(moved, []);
  });

  it('ids each arrow from the prefix', () => {
    const { up, down } = show(0, 2, 'dx-I10');
    assert.equal(up.id, 'dx-I10-up');
    assert.equal(down.id, 'dx-I10-down');
  });

  it('leaves the arrows without ids when there is no prefix', () => {
    const { up, down } = show(0, 2);
    assert.equal(up.hasAttribute('id'), false);
    assert.equal(down.hasAttribute('id'), false);
  });
});
