import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { render, screen } from '../testing-dom.ts';
import { Card } from './card.tsx';

describe('Card', () => {
  it('is a region named by its heading', () => {
    render(
      createElement(Card, {
        labelledBy: 'title',
        children: [
          createElement('h2', { key: 'h', id: 'title' }, 'Sign In'),
          createElement('p', { key: 'p' }, 'Body')
        ]
      })
    );
    const card = screen.getByRole('region', { name: 'Sign In' });
    assert.equal(card.tagName, 'SECTION');
    assert.equal(card.textContent, 'Sign InBody');
  });

  it('is drawn flat, without a shadow', () => {
    render(createElement(Card, { labelledBy: 'x', children: 'Body' }));
    const card = screen.getByText('Body');
    assert.deepEqual(
      [...card.classList].filter((c) => c.includes('shadow')),
      []
    );
  });
});
