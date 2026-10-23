import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Card } from './card.tsx';

describe('Card', () => {
  it('renders a labelled section', () => {
    const html = renderToStaticMarkup(
      createElement(Card, { labelledBy: 'title', children: 'Body' })
    );
    assert.ok(html.startsWith('<section aria-labelledby="title"'));
    assert.ok(html.includes('Body'));
  });
});
