import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { resolveInitialTheme, ThemeToggle } from './theme-toggle.tsx';

describe('ThemeToggle', () => {
  it('resolves initial theme from storage or media preference', () => {
    assert.equal(resolveInitialTheme('dark', false), 'dark');
    assert.equal(resolveInitialTheme('light', true), 'light');
    assert.equal(resolveInitialTheme(null, true), 'dark');
    assert.equal(resolveInitialTheme(null, false), 'light');
  });

  it('renders accessible icon toggle button for light and dark states', () => {
    const lightHtml = renderToStaticMarkup(createElement(ThemeToggle, { initialTheme: 'light' }));
    assert.ok(lightHtml.includes('aria-label="Switch to dark mode"'));
    assert.ok(lightHtml.includes('cursor-pointer'));

    const darkHtml = renderToStaticMarkup(createElement(ThemeToggle, { initialTheme: 'dark' }));
    assert.ok(darkHtml.includes('aria-label="Switch to light mode"'));
  });
});
