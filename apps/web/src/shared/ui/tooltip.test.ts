import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Tooltip } from './tooltip.tsx';

describe('Tooltip', () => {
  it('anchors a hidden manual popover to its trigger on the chosen side', () => {
    const html = renderToStaticMarkup(
      createElement(Tooltip, {
        label: 'Sign Out',
        side: 'top',
        children: createElement('button', { type: 'button' })
      })
    );
    assert.ok(html.includes('<button type="button"></button>'));
    assert.ok(html.includes('popover="manual"'));
    assert.ok(html.includes('aria-hidden="true"'));
    assert.ok(html.includes('[position-area:top]'));
    assert.match(html, /anchor-name:(--anchor-[\w-]+).*position-anchor:\1/);
    assert.ok(html.includes('Sign Out'));
  });
});
