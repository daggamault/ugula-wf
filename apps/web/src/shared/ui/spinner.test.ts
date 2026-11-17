import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { render, screen } from '../testing-dom.ts';
import { PendingOverlay, Spinner } from './spinner.tsx';

describe('Spinner', () => {
  it('announces loading as a named status', () => {
    render(createElement(Spinner));
    const status = screen.getByRole('status', { name: 'Loading' });
    assert.equal(status.textContent, '');
  });

  it('animates four staggered bars', () => {
    render(createElement(Spinner));
    const bars = [...screen.getByRole('status').children];
    assert.deepEqual(
      bars.map((bar) => bar.classList.contains('animate-bars')),
      [true, true, true, true]
    );
    assert.deepEqual(
      bars.map((bar) => [...bar.classList].find((c) => c.startsWith('[animation-delay:'))),
      [
        '[animation-delay:0ms]',
        '[animation-delay:120ms]',
        '[animation-delay:240ms]',
        '[animation-delay:360ms]'
      ]
    );
  });
});

describe('PendingOverlay', () => {
  it('animates the same bars hidden from assistive technology', () => {
    const { container } = render(createElement(PendingOverlay));
    const overlay = container.firstElementChild;
    assert.equal(overlay?.getAttribute('aria-hidden'), 'true');
    assert.ok(!screen.queryByRole('status'));
    assert.equal(overlay?.querySelectorAll('.animate-bars').length, 4);
  });
});
