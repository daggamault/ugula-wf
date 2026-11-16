import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PAGE_FAILED, PageBoundary } from './page-boundary.tsx';

describe('PageBoundary', () => {
  it('shows its page until the page throws, then a failure the user can reload from', () => {
    assert.equal(
      renderToStaticMarkup(createElement(PageBoundary, null, createElement('p', null, 'Claims'))),
      '<p>Claims</p>'
    );
    const boundary = new PageBoundary({ children: createElement('p', null, 'Claims') });
    boundary.state = PageBoundary.getDerivedStateFromError();
    const html = renderToStaticMarkup(createElement('div', null, boundary.render()));
    assert.ok(html.includes(PAGE_FAILED));
    assert.ok(!html.includes('Claims'));
  });
});
