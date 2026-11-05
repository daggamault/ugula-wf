import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Brand, BrandHeader } from './brand.tsx';

describe('Brand', () => {
  it('renders the wordmark', () => {
    assert.ok(renderToStaticMarkup(createElement(Brand)).includes('>ugula</span>'));
  });

  it('heads a card with the wordmark and a tagline', () => {
    const html = renderToStaticMarkup(
      createElement(BrandHeader, { id: 'h', children: 'Sign in.' })
    );
    assert.ok(html.includes('<h1 id="h">'));
    assert.ok(html.includes('<p class="text-base font-bold">Sign in.</p>'));
    assert.ok(!html.includes('text-surface-fg-muted'));
  });

  it('adds one sentence saying what the card is for', () => {
    const html = renderToStaticMarkup(
      createElement(BrandHeader, { children: 'Sign In', description: 'Use your work email.' })
    );
    assert.ok(html.includes('<p class="text-surface-fg-muted text-sm">Use your work email.</p>'));
  });
});
