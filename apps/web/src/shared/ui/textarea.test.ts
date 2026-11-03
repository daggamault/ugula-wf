import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Textarea } from './textarea.tsx';

describe('Textarea', () => {
  it('renders a labelled body-text textarea with a linked hint', () => {
    const html = renderToStaticMarkup(
      createElement(Textarea, { id: 'note', label: 'Note', hint: 'Any value' })
    );
    assert.ok(html.includes('for="note"') && html.includes('aria-describedby="note-hint"'));
    assert.ok(!html.includes('font-mono') && html.includes('sm:text-sm'));
    assert.ok(html.includes('Any value') && html.includes('rounded-lg'));
  });

  it('marks an invalid textarea and links its error', () => {
    const html = renderToStaticMarkup(
      createElement(Textarea, { id: 'note', label: 'Note', error: 'Too long', hint: 'Any value' })
    );
    assert.ok(html.includes('aria-invalid="true"'));
    assert.ok(html.includes('aria-describedby="note-error"'));
    assert.ok(html.includes('Too long') && !html.includes('Any value'));
  });

  it('switches to monospace without spell checking when asked', () => {
    const html = renderToStaticMarkup(
      createElement(Textarea, { id: 'json', label: 'JSON', isMonospace: true })
    );
    assert.ok(html.includes('font-mono'));
    assert.match(html, /spell[cC]heck="false"/);
  });
});
