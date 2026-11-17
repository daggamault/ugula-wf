import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { render, screen } from '../testing-dom.ts';
import { PAGE_FAILED, PageBoundary } from './page-boundary.tsx';

const Broken = () => {
  throw new Error('boom');
};

describe('PageBoundary', () => {
  it('shows its page while the page renders', () => {
    render(createElement(PageBoundary, null, createElement('p', null, 'Claims')));
    assert.equal(screen.getByText('Claims').tagName, 'P');
    assert.ok(!screen.queryByRole('heading'));
  });

  it('replaces a page that throws with a failure the user can reload from', (t) => {
    t.mock.method(console, 'error', () => undefined);
    render(
      createElement(PageBoundary, null, createElement('p', null, 'Claims'), createElement(Broken))
    );
    assert.equal(screen.getByRole('heading', { level: 1 }).textContent, 'Something Went Wrong');
    assert.equal(screen.getByText(PAGE_FAILED).textContent, PAGE_FAILED);
    assert.ok(!screen.queryByText('Claims'));
  });
});
