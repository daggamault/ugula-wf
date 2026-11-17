import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { render, screen, userEvent } from '../testing-dom.ts';
import { EmptyState, EmptyText, emptyValue } from './empty-state.tsx';

const hasIcon = (container: HTMLElement, icon: string) =>
  container.querySelector('svg')?.classList.contains(icon) ?? false;

describe('EmptyState', () => {
  it('titles the message with a section heading by default', () => {
    const { container } = render(createElement(EmptyState, { title: 'No Runs' }));
    screen.getByRole('heading', { level: 2, name: 'No Runs' });
    assert.ok(!container.querySelector('p'));
    assert.ok(!screen.queryByRole('button'));
  });

  it('uses the heading level it is given', () => {
    render(createElement(EmptyState, { title: 'No Fees', heading: 'h1' }));
    screen.getByRole('heading', { level: 1, name: 'No Fees' });
  });

  it('explains below the title and offers a working action', async () => {
    const clicks: string[] = [];
    const { container } = render(
      createElement(EmptyState, {
        title: 'No Fees',
        action: createElement(
          'button',
          { type: 'button', onClick: () => clicks.push('add') },
          'Add'
        ),
        children: 'Add one above.'
      })
    );
    assert.equal(container.querySelector('p')?.textContent, 'Add one above.');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Add' }));
    assert.deepEqual(clicks, ['add']);
  });

  it('shows a decorative icon that fits the reason', () => {
    const cases = [
      [undefined, 'lucide-inbox'],
      ['clear', 'lucide-circle-check-big'],
      ['noMatches', 'lucide-search-x'],
      ['error', 'lucide-triangle-alert']
    ] as const;
    for (const [reason, icon] of cases) {
      const { container, unmount } = render(
        createElement(EmptyState, { title: 'T', ...(reason ? { reason } : {}) })
      );
      assert.equal(hasIcon(container, icon), true, reason ?? 'empty');
      assert.equal(container.querySelector('svg')?.closest('[aria-hidden="true"]') !== null, true);
      unmount();
    }
  });
});

describe('EmptyText', () => {
  it('renders a compact message with a decorative icon for the reason', () => {
    const { container } = render(
      createElement(EmptyText, { reason: 'clear', children: 'All clear.' })
    );
    assert.equal(container.querySelector('p')?.textContent, 'All clear.');
    assert.equal(hasIcon(container, 'lucide-circle-check-big'), true);
    assert.equal(container.querySelector('svg')?.closest('[aria-hidden="true"]') !== null, true);
    assert.ok(!screen.queryByRole('heading'));
  });

  it('defaults to the empty icon', () => {
    const { container } = render(createElement(EmptyText, { children: 'Nothing yet.' }));
    assert.equal(hasIcon(container, 'lucide-inbox'), true);
  });
});

describe('emptyValue', () => {
  it('is an em dash', () => {
    assert.equal(emptyValue, '—');
  });
});
