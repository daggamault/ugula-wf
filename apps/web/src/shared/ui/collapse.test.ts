import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { render, screen } from '../testing-dom.ts';
import { Collapse } from './collapse.tsx';

const show = (isOpen: boolean) =>
  render(
    createElement(Collapse, {
      id: 'menu',
      isOpen,
      children: createElement('a', { href: '/runs' }, 'Runs')
    })
  );

const region = () => document.getElementById('menu');

describe('Collapse', () => {
  it('shows open content as interactive', () => {
    show(true);
    assert.equal(region()?.hasAttribute('inert'), false);
    assert.equal(region()?.classList.contains('grid-rows-[1fr]'), true);
    screen.getByRole('link', { name: 'Runs' });
  });

  it('collapses closed content and makes it inert', () => {
    show(false);
    assert.equal(region()?.hasAttribute('inert'), true);
    assert.equal(region()?.classList.contains('grid-rows-[0fr]'), true);
  });

  it('toggles inertness as it opens and closes', () => {
    const { rerender } = show(false);
    const make = (isOpen: boolean) =>
      createElement(Collapse, { id: 'menu', isOpen, children: 'Links' });
    rerender(make(true));
    assert.equal(region()?.hasAttribute('inert'), false);
    rerender(make(false));
    assert.equal(region()?.hasAttribute('inert'), true);
  });
});
