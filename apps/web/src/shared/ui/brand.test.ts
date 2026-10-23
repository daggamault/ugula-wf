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
    assert.ok(html.includes('Sign in.'));
  });
});
