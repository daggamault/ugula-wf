import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Dialog } from './dialog.tsx';

describe('Dialog', () => {
  it('renders a labelled native dialog', () => {
    const html = renderToStaticMarkup(
      createElement(Dialog, {
        open: true,
        title: 'New workflow',
        onClose: () => undefined,
        children: 'Body'
      })
    );
    assert.ok(html.startsWith('<dialog'));
    assert.match(html, /aria-labelledby="([^"]+)".*<h2 id="\1"/);
    assert.ok(html.includes('New workflow'));
    assert.ok(html.includes('Body'));
  });
});
