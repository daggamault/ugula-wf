import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeToggle, useDocumentTheme } from './theme-toggle.tsx';

describe('ThemeToggle', () => {
  it('renders an accessible icon toggle that follows the document theme', () => {
    const html = renderToStaticMarkup(createElement(ThemeToggle));
    assert.ok(html.includes('aria-label="Switch to Dark Mode"'));
    assert.ok(html.includes('<svg'));
  });
});

describe('useDocumentTheme', () => {
  it('falls back to light when rendered without a document', () => {
    const Probe = () => createElement('p', null, useDocumentTheme());
    assert.equal(renderToStaticMarkup(createElement(Probe)), '<p>light</p>');
  });
});
