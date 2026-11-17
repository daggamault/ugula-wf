import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PaletteEntry } from '../../shared/graph/catalog.ts';
import { createCatalog } from '../../shared/graph/catalog.ts';
import { testNodes } from '../../shared/testing.ts';
import { render, screen, userEvent } from '../../shared/testing-dom.ts';
import { groupPalette, NodePicker, nextActive } from './node-picker.tsx';

HTMLElement.prototype.showPopover ??= () => undefined;

const { palette } = createCatalog(testNodes);

const typesOf = (groups: ReturnType<typeof groupPalette>) =>
  groups.flatMap(([, items]) => items.map((i) => i.type));

const some = palette.filter((e) => ['Add', 'Subtract', 'Round', 'Expression'].includes(e.title));

const open = (entries: readonly PaletteEntry[] = some) => {
  const added: string[] = [];
  const closed: number[] = [];
  render(
    createElement(NodePicker, {
      entries,
      at: { x: 40, y: 60 },
      hint: 'Nodes that connect to Total.',
      onAdd: (e) => added.push(e.title),
      onClose: () => closed.push(1)
    })
  );
  return { added, closed, user: userEvent.setup() };
};

afterEach(() => localStorage.clear());

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
  it('opens at the point with the hint and the search focused', () => {
    const html = renderToStaticMarkup(
      createElement(NodePicker, {
        entries: some,
        at: { x: 40, y: 60 },
        hint: 'Nodes that connect to Total.',
        onAdd: () => undefined,
        onClose: () => undefined
      })
    );
    assert.ok(html.includes('40px') && html.includes('60px'));
    open();
    assert.equal(
      screen
        .getByRole('dialog', { name: 'Add Node' })
        .textContent?.includes('Nodes that connect to Total.'),
      true
    );
    assert.ok(document.activeElement === screen.getByRole('combobox', { name: 'Search Nodes' }));
  });

  it('adds the first match of a search with Enter', async () => {
    const { added, user } = open();
    await user.keyboard('subtr{Enter}');
    assert.deepEqual(added, ['Subtract']);
  });

  it('moves the highlight with the arrow keys before adding', async () => {
    const { added, user } = open();
    const options = screen.getAllByRole('option');
    assert.equal(options[0]?.getAttribute('aria-selected'), 'true');
    await user.keyboard('{ArrowDown}');
    assert.equal(screen.getAllByRole('option')[1]?.getAttribute('aria-selected'), 'true');
    await user.keyboard('{Enter}');
    assert.deepEqual(added, [options[1]?.querySelector('span')?.textContent]);
  });

  it('adds a clicked node', async () => {
    const { added, user } = open();
    await user.click(screen.getByRole('option', { name: /^Round/ }));
    assert.deepEqual(added, ['Round']);
  });

  it('closes on Escape and on a click outside, but not on a click inside', async () => {
    const { closed, user } = open();
    await user.click(screen.getByRole('heading', { name: 'Add Node' }));
    assert.equal(closed.length, 0);
    await user.keyboard('{Escape}');
    assert.equal(closed.length, 1);
    await user.click(document.body);
    assert.equal(closed.length, 2);
  });

  it('hides advanced nodes until asked, says when only they match, and remembers the choice', async () => {
    const { added, user } = open();
    assert.ok(!screen.queryByRole('option', { name: /^Expression/ }));
    await user.keyboard('expression');
    assert.ok(screen.getByText('Only advanced nodes match. Turn on Show Advanced to see them.'));
    await user.keyboard('{Enter}');
    assert.deepEqual(added, []);
    await user.click(screen.getByRole('checkbox', { name: 'Show Advanced' }));
    assert.ok(screen.getByRole('option', { name: /^Expression/ }));
    assert.equal(localStorage.getItem('workflows.picker.advanced'), 'shown');
  });

  it('opens with advanced nodes shown when that was the last choice', () => {
    localStorage.setItem('workflows.picker.advanced', 'shown');
    open();
    assert.ok(screen.getByRole('option', { name: /^Expression/ }));
    assert.equal(
      (screen.getByRole('checkbox', { name: 'Show Advanced' }) as HTMLInputElement).checked,
      true
    );
  });

  it('says what was searched for when nothing matches', async () => {
    const { user } = open();
    await user.keyboard('zzz');
    assert.ok(screen.getByText('No node matches “zzz”.'));
  });

  it('says when nothing fits the pin', () => {
    open([]);
    assert.ok(screen.getByText('No node fits here.'));
  });
});
