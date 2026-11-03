import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createCatalog } from '../../shared/graph/catalog.ts';
import { testNodes } from '../../shared/testing.ts';
import { groupPalette, NodeList, NodePicker } from './node-picker.tsx';

const { palette } = createCatalog(testNodes);

describe('NodePicker', () => {
  it('groups nodes by category and finds them by title or what they do', () => {
    const all = groupPalette(palette, '');
    assert.ok(all.some(([category]) => category === 'Flow'));
    assert.ok(
      groupPalette(palette, 'for each')
        .flatMap(([, items]) => items.map((i) => i.type))
        .includes('std.flow.for-each')
    );
    assert.ok(
      groupPalette(palette, 'decimal places')
        .flatMap(([, items]) => items.map((i) => i.type))
        .includes('std.math.round')
    );
  });

  it('lists each node with what it does as one button that adds it', () => {
    const html = renderToStaticMarkup(
      createElement(NodeList, { entries: palette, query: 'round', onAdd: () => undefined })
    );
    assert.ok(html.includes('Rounds a number to the given number of decimal places.'));
    assert.ok(html.includes('<button type="button"'));
    const none = renderToStaticMarkup(
      createElement(NodeList, { entries: palette, query: 'zzz', onAdd: () => undefined })
    );
    assert.ok(none.includes('No node matches'));
  });

  it('opens as a searchable dialog', () => {
    const html = renderToStaticMarkup(
      createElement(NodePicker, {
        open: true,
        entries: palette,
        onAdd: () => undefined,
        onClose: () => undefined
      })
    );
    assert.ok(html.includes('Add Node'));
    assert.ok(html.includes('type="search"'));
  });
});
