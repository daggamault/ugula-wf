import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Collapse } from './collapse.tsx';

const render = (isOpen: boolean) =>
  renderToStaticMarkup(createElement(Collapse, { id: 'menu', isOpen, children: 'Links' }));

describe('Collapse', () => {
  it('expands open content and makes closed content inert', () => {
    assert.ok(render(true).includes('grid-rows-[1fr]'));
    assert.ok(!render(true).includes('inert'));
    assert.ok(render(false).includes('grid-rows-[0fr]'));
    assert.ok(render(false).includes('inert=""'));
    assert.ok(render(false).includes('id="menu"'));
  });
});
