import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createCatalog } from '../../shared/graph/catalog.ts';
import { groupPalette, Palette } from './palette.tsx';

const { palette } = createCatalog();

describe('Palette', () => {
  it('groups entries by category and filters by search text', () => {
    const all = groupPalette(palette, '');
    assert.ok(all.some(([category]) => category === 'Flow'));
    const found = groupPalette(palette, 'for each');
    assert.deepEqual(
      found.flatMap(([, items]) => items.map((i) => i.type)),
      ['std.flow.for-each']
    );
  });

  it('renders addable entries', () => {
    const html = renderToStaticMarkup(
      createElement(Palette, { entries: palette, disabled: true, onAdd: () => undefined })
    );
    assert.ok(html.includes('aria-label="Node palette"'));
    assert.ok(html.includes('For Each'));
    assert.ok(html.includes('disabled'));
  });
});
