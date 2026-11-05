import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Drawer } from './drawer.tsx';

describe('Drawer', () => {
  it('slides a floating panel in from the right edge', () => {
    const html = renderToStaticMarkup(createElement(Drawer, { width: 'md', children: 'Body' }));
    assert.ok(html.includes('absolute inset-y-0 right-0'));
    assert.ok(html.includes('bg-surface') && html.includes('shadow-lg'));
    assert.ok(html.includes('starting:translate-x-4'));
    assert.ok(html.endsWith('Body</div>'));
  });

  it('is full width on mobile and sized from small screens up', () => {
    const md = renderToStaticMarkup(createElement(Drawer, { width: 'md', children: null }));
    const lg = renderToStaticMarkup(createElement(Drawer, { width: 'lg', children: null }));
    assert.ok(md.includes('w-full') && md.includes('sm:w-96') && !md.includes('sm:w-[32rem]'));
    assert.ok(lg.includes('sm:w-[32rem]') && !lg.includes('sm:w-96'));
  });
});
