import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EmptyState, EmptyText } from './empty-state.tsx';

describe('EmptyState', () => {
  it('renders a titled message with an optional action', () => {
    const html = renderToStaticMarkup(
      createElement(EmptyState, {
        title: 'No Fees',
        heading: 'h1',
        action: createElement('button', { type: 'button' }, 'Add'),
        children: 'Add one above.'
      })
    );
    assert.ok(html.includes('<h1'));
    assert.ok(html.includes('No Fees'));
    assert.ok(html.includes('Add one above.'));
    assert.ok(html.includes('<button type="button">Add</button>'));
  });

  it('defaults to a section heading with a decorative icon that fits the reason', () => {
    const empty = renderToStaticMarkup(createElement(EmptyState, { title: 'No Runs' }));
    assert.ok(empty.includes('<h2 class="text-base font-bold">No Runs</h2>'));
    assert.ok(empty.includes('lucide-inbox') && empty.includes('rounded-xl'));
    assert.match(empty, /<span aria-hidden="true"[^>]*><svg/);
    assert.ok(!empty.includes('<p class'));
    const failed = renderToStaticMarkup(
      createElement(EmptyState, { reason: 'error', title: 'Something Went Wrong' })
    );
    assert.ok(failed.includes('lucide-triangle-alert'));
  });
});

describe('EmptyText', () => {
  it('renders a compact message with an icon', () => {
    const html = renderToStaticMarkup(
      createElement(EmptyText, { reason: 'clear', children: 'All clear.' })
    );
    assert.ok(html.includes('<svg'));
    assert.ok(html.includes('All clear.'));
  });
});
