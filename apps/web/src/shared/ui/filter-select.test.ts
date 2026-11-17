import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { render, screen, userEvent } from '../testing-dom.ts';
import { FilterSelect, hrefOf } from './filter-select.tsx';

const options = [
  { value: 'open', label: 'Open', href: '/claims' },
  { value: 'paid', label: 'Paid', href: '/claims?view=paid' }
];

const show = (value = 'open') => {
  render(createElement(FilterSelect, { id: 'status', label: 'Status', value, options }));
  return { trigger: screen.getByRole('button', { name: 'Status' }), user: userEvent.setup() };
};

describe('FilterSelect', () => {
  it('names the select by a visually hidden label and shows the current filter', () => {
    const { trigger } = show('paid');
    assert.equal(trigger.textContent, 'Paid');
    assert.equal(
      screen.getByText('Status', { selector: 'label' }).classList.contains('sr-only'),
      true
    );
    assert.deepEqual(
      screen.getAllByRole('option', { selected: true, hidden: true }).map((o) => o.textContent),
      ['Paid']
    );
  });

  it('navigates to the link of the chosen filter', async () => {
    const { trigger, user } = show();
    trigger.focus();
    await user.keyboard('{ArrowDown}');
    await user.click(screen.getByRole('option', { name: 'Paid' }));
    assert.equal(`${window.location.pathname}${window.location.search}`, '/claims?view=paid');
  });

  it('stays put when the current filter is chosen again', async () => {
    window.history.replaceState(null, '', '/claims?page=2');
    const { trigger, user } = show();
    trigger.focus();
    await user.keyboard('{ArrowDown}');
    await user.click(screen.getByRole('option', { name: 'Open' }));
    assert.equal(`${window.location.pathname}${window.location.search}`, '/claims?page=2');
  });
});

describe('hrefOf', () => {
  it('finds the link for a value, or nothing for an unknown one', () => {
    assert.equal(hrefOf(options, 'paid'), '/claims?view=paid');
    assert.equal(hrefOf(options, 'missing'), undefined);
  });
});
