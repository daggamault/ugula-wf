import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ListRows, moved } from './list-rows.tsx';

const render = (editable: boolean, items: string[] = ['a', 'b']) =>
  renderToStaticMarkup(
    createElement(ListRows<string>, {
      id: 'rows',
      noun: 'Case',
      items,
      editable,
      blank: () => '',
      onChange: () => undefined,
      children: (item: string) => createElement('span', null, item)
    })
  );

describe('ListRows', () => {
  it('lists rows with reorder and remove buttons, and adds a row by its noun', () => {
    const html = render(true);
    assert.ok(html.includes('<ol') && html.includes('<span>b</span>'));
    assert.ok(html.includes('Move Case 1 up') && html.includes('Remove Case 2'));
    assert.ok(html.includes('Already first.') && html.includes('Add Case'));
    assert.ok(!render(true, []).includes('<ol'));
  });

  it('shows only the rows when read-only', () => {
    const html = render(false);
    assert.ok(html.includes('<span>a</span>'));
    assert.ok(!html.includes('Remove Case 1') && !html.includes('Add Case'));
  });
});

describe('moved', () => {
  it('moves an item up or down and keeps the list when it cannot', () => {
    assert.deepEqual(moved(['a', 'b', 'c'], 1, -1), ['b', 'a', 'c']);
    assert.deepEqual(moved(['a', 'b', 'c'], 1, 1), ['a', 'c', 'b']);
    assert.deepEqual(moved(['a', 'b'], 0, -1), ['a', 'b']);
    assert.deepEqual(moved(['a', 'b'], 1, 1), ['a', 'b']);
  });
});
