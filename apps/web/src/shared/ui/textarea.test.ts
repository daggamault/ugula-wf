import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Textarea } from './textarea.tsx';

describe('Textarea', () => {
  it('renders a monospace labelled textarea with a hint', () => {
    const html = renderToStaticMarkup(
      createElement(Textarea, { id: 'json', label: 'JSON', hint: 'Any value' })
    );
    assert.ok(html.includes('font-mono'));
    assert.ok(html.includes('spellCheck="false"') || html.includes('spellcheck="false"'));
    assert.ok(html.includes('Any value'));
  });
});
