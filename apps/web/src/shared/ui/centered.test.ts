import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Centered } from './centered.tsx';

describe('Centered', () => {
  it('centers a page on the screen with the theme toggle in the corner', () => {
    const html = renderToStaticMarkup(createElement(Centered, { children: 'Body' }));
    assert.ok(html.startsWith('<main class="grid min-h-dvh place-items-center p-4">'));
    assert.ok(html.includes('fixed top-4 right-4'));
    assert.ok(html.endsWith('Body</main>'));
  });
});
