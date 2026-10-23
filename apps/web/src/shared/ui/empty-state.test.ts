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
