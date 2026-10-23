import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EmptyState } from './empty-state.tsx';
import { Page } from './page.tsx';

describe('Page', () => {
  it('renders a titled section with description, actions and content', () => {
    const html = renderToStaticMarkup(
      createElement(
        Page,
        {
          title: 'Runs',
          description: 'All runs',
          actions: createElement('button', { type: 'button' }, 'New')
        },
        createElement(EmptyState, { title: 'Nothing yet' })
      )
    );
    assert.ok(html.startsWith('<section'));
    assert.ok(html.includes('<h1'));
    assert.ok(html.includes('All runs'));
    assert.ok(html.includes('<button type="button">New</button>'));
    assert.ok(html.includes('Nothing yet'));
  });
});
