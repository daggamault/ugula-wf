import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { resolveInitialTheme, ThemeToggle, useDocumentTheme } from './theme-toggle.tsx';

describe('ThemeToggle', () => {
  it('resolves initial theme from storage or media preference', () => {
    assert.equal(resolveInitialTheme('dark', false), 'dark');
    assert.equal(resolveInitialTheme('light', true), 'light');
    assert.equal(resolveInitialTheme(null, true), 'dark');
    assert.equal(resolveInitialTheme(null, false), 'light');
  });

  it('renders accessible icon toggle button for light and dark states', () => {
    const lightHtml = renderToStaticMarkup(createElement(ThemeToggle, { initialTheme: 'light' }));
    assert.ok(lightHtml.includes('aria-label="Switch to Dark Mode"'));
    assert.ok(lightHtml.includes('<svg'));

    const darkHtml = renderToStaticMarkup(createElement(ThemeToggle, { initialTheme: 'dark' }));
    assert.ok(darkHtml.includes('aria-label="Switch to Light Mode"'));
  });
});

describe('useDocumentTheme', () => {
  it('falls back to light when rendered without a document', () => {
    const Probe = () => createElement('p', null, useDocumentTheme());
    assert.equal(renderToStaticMarkup(createElement(Probe)), '<p>light</p>');
  });
});
