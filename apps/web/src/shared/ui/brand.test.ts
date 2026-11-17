import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { render, screen } from '../testing-dom.ts';
import { Brand, BrandHeader } from './brand.tsx';

describe('Brand', () => {
  it('renders the wordmark', () => {
    const { container } = render(createElement(Brand));
    assert.equal(container.textContent, 'ugula');
  });
});

describe('BrandHeader', () => {
  it('shows the wordmark above a heading that names the card', () => {
    const { container } = render(createElement(BrandHeader, { id: 'h', children: 'Sign In' }));
    const heading = screen.getByRole('heading', { level: 1, name: 'Sign In' });
    assert.equal(heading.id, 'h');
    assert.equal(container.textContent, 'ugulaSign In');
    assert.ok(!screen.queryByRole('heading', { name: 'ugula' }));
  });

  it('adds one sentence saying what the card is for', () => {
    const { container } = render(
      createElement(BrandHeader, { children: 'Sign In', description: 'Use your work email.' })
    );
    assert.deepEqual(
      [...container.querySelectorAll('p')].map((p) => p.textContent),
      ['Use your work email.']
    );
  });
});
