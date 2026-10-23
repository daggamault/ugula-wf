import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PendingOverlay, Spinner } from './spinner.tsx';

describe('Spinner', () => {
  it('announces loading with animated bars', () => {
    const html = renderToStaticMarkup(createElement(Spinner));
    assert.ok(html.includes('role="status"'));
    assert.ok(html.includes('aria-label="Loading"'));
    assert.equal(html.match(/animate-bars/g)?.length, 4);
  });

  it('renders a hidden overlay for pending buttons', () => {
    const html = renderToStaticMarkup(createElement(PendingOverlay));
    assert.ok(html.includes('aria-hidden="true"'));
    assert.equal(html.match(/animate-bars/g)?.length, 4);
  });
});
