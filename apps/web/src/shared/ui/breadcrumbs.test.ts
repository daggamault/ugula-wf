import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { render, screen, userEvent, within } from '../testing-dom.ts';
import { Breadcrumbs } from './breadcrumbs.tsx';

const show = (selected: string[] = []) => {
  render(
    createElement(Breadcrumbs, {
      label: 'Workflow path',
      crumbs: [
        { label: 'Workflows', to: '/workflows' },
        { label: 'Process PCR', onSelect: () => selected.push('pcr') },
        { label: 'Resolve Payers' }
      ]
    })
  );
  return screen.getByRole('navigation', { name: 'Workflow path' });
};

describe('Breadcrumbs', () => {
  it('lists every level in order', () => {
    const nav = show();
    assert.deepEqual(
      within(nav)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
      ['Workflows', 'Process PCR', 'Resolve Payers']
    );
  });

  it('marks the last level as the current page without making it interactive', () => {
    const nav = show();
    const current = within(nav).getByText('Resolve Payers');
    assert.equal(current.getAttribute('aria-current'), 'page');
    assert.equal(current.tagName, 'SPAN');
    assert.ok(!within(nav).queryByRole('link', { name: 'Resolve Payers' }));
    assert.ok(!within(nav).queryByRole('button', { name: 'Resolve Payers' }));
  });

  it('marks the only level as the current page even when it has a destination', () => {
    render(createElement(Breadcrumbs, { label: 'Path', crumbs: [{ label: 'Home', to: '/home' }] }));
    assert.equal(screen.getByText('Home').getAttribute('aria-current'), 'page');
    assert.ok(!screen.queryByRole('link'));
  });

  it('links a level with a destination and navigates there', async () => {
    const nav = show();
    const link = within(nav).getByRole('link', { name: 'Workflows' });
    assert.equal(link.getAttribute('href'), '/workflows');
    await userEvent.setup().click(link);
    assert.equal(window.location.pathname, '/workflows');
  });

  it('selects a level without a destination through a button', async () => {
    const selected: string[] = [];
    const nav = show(selected);
    await userEvent.setup().click(within(nav).getByRole('button', { name: 'Process PCR' }));
    assert.deepEqual(selected, ['pcr']);
  });

  it('separates levels with decorative chevrons', () => {
    const nav = show();
    assert.deepEqual(
      [...nav.querySelectorAll('svg')].map((i) => i.getAttribute('aria-hidden')),
      ['true', 'true']
    );
  });
});
