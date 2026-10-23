import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JsonView } from './json-view.tsx';

describe('JsonView', () => {
  it('pretty prints values and marks missing ones', () => {
    const html = renderToStaticMarkup(
      createElement(JsonView, { label: 'Inputs', value: { a: 1 } })
    );
    assert.ok(html.includes('<figcaption class="sr-only">Inputs</figcaption>'));
    assert.ok(html.includes('&quot;a&quot;: 1'));
    assert.ok(
      renderToStaticMarkup(createElement(JsonView, { label: 'x', value: undefined })).includes('—')
    );
  });
});
