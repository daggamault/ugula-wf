import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createCatalog } from '../../shared/graph/catalog.ts';
import { testNodes } from '../../shared/testing.ts';
import { groupPalette, NodePicker, nextActive } from './node-picker.tsx';

const { palette } = createCatalog(testNodes);

const typesOf = (groups: ReturnType<typeof groupPalette>) =>
  groups.flatMap(([, items]) => items.map((i) => i.type));

const render = (query = '') =>
  renderToStaticMarkup(
    createElement(NodePicker, {
      entries: query ? palette.filter((e) => e.title.includes(query)) : palette,
      at: { x: 40, y: 60 },
      hint: 'Nodes that connect to Total.',
      onAdd: () => undefined,
      onClose: () => undefined
    })
  );

describe('groupPalette', () => {
  it('groups nodes by category and finds them by title, description or keyword', () => {
    assert.ok(groupPalette(palette, '').some(([category]) => category === 'Flow'));
    assert.ok(typesOf(groupPalette(palette, 'for each')).includes('std.flow.for-each'));
    assert.ok(typesOf(groupPalette(palette, 'decimal places')).includes('std.math.round'));
    assert.ok(typesOf(groupPalette(palette, 'knot')).includes('std.flow.reroute'));
    assert.deepEqual(groupPalette(palette, 'zzz'), []);
  });

  it('shows basic nodes only until advanced ones are asked for', () => {
    const basic = typesOf(groupPalette(palette, 'formula', false));
    assert.ok(!basic.includes('std.expr'));
    assert.ok(typesOf(groupPalette(palette, '', false)).includes('std.flow.reroute'));
  });
});

describe('nextActive', () => {
  it('moves through the options with the arrow keys and wraps around', () => {
    assert.equal(nextActive(3, 0, 'ArrowDown'), 1);
    assert.equal(nextActive(3, 2, 'ArrowDown'), 0);
    assert.equal(nextActive(3, 0, 'ArrowUp'), 2);
    assert.equal(nextActive(3, 1, 'End'), 2);
    assert.equal(nextActive(3, 2, 'Home'), 0);
    assert.equal(nextActive(0, 0, 'ArrowDown'), 0);
    assert.equal(nextActive(3, 1, 'x'), 1);
  });
});

describe('NodePicker', () => {
  it('opens as a searchable popover at the point with grouped options', () => {
    const html = render();
    assert.ok(html.includes('popover="manual"') && html.includes('role="dialog"'));
    assert.ok(html.includes('Add Node') && html.includes('Nodes that connect to Total.'));
    assert.ok(html.includes('role="combobox"') && html.includes('role="listbox"'));
    assert.ok(html.includes('role="option"') && html.includes('<legend'));
    assert.ok(html.includes('Show Advanced') && html.includes('shadow-lg'));
    assert.ok(html.includes('40px') && html.includes('60px'));
  });

  it('explains when nothing fits', () => {
    assert.ok(render('Nothing Like This').includes('No node fits here.'));
  });
});
