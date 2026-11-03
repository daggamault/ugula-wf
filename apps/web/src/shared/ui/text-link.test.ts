import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TextLink, textLinkClasses } from './text-link.tsx';

describe('TextLink', () => {
  it('renders a pointer link in the primary color', () => {
    const html = renderToStaticMarkup(createElement(TextLink, { to: '/claims/c1' }, 'Doe, Jane'));
    assert.ok(html.includes('href="/claims/c1"'));
    assert.ok(textLinkClasses.includes('text-primary'));
    assert.ok(textLinkClasses.includes('cursor-pointer'));
    assert.ok(textLinkClasses.includes('focus-visible:outline-primary'));
    assert.ok(html.includes('>Doe, Jane</a>'));
  });
});
