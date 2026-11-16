import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ENTRY_TYPE } from '@ugula/graph';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { testNodes } from '../testing.ts';
import { createCatalog } from './catalog.ts';
import {
  GraphCanvas,
  nodeClicks,
  OPENING_WIDTH,
  openingNodes,
  selectionOf
} from './graph-canvas.tsx';

describe('GraphCanvas', () => {
  it('renders a React Flow surface for a graph', () => {
    const html = renderToStaticMarkup(
      createElement(GraphCanvas, {
        def: {
          signature: { execIn: ['exec'], execOut: [], inputs: [], outputs: [] },
          variables: [],
          nodes: [{ id: 'entry', type: ENTRY_TYPE, version: 1 }],
          edges: []
        },
        catalog: createCatalog(testNodes),
        selected: null,
        onSelect: () => undefined
      })
    );
    assert.ok(html.includes('react-flow'));
    assert.ok(html.includes('min-h-96'));
    assert.ok(!html.includes('Add Comment'), 'read-only canvases offer no editing tools');
  });

  it('offers editing tools on editable canvases', () => {
    const html = renderToStaticMarkup(
      createElement(GraphCanvas, {
        def: {
          signature: { execIn: ['exec'], execOut: [], inputs: [], outputs: [] },
          variables: [],
          nodes: [{ id: 'entry', type: ENTRY_TYPE, version: 1 }],
          edges: []
        },
        catalog: createCatalog(testNodes),
        selected: null,
        onSelect: () => undefined,
        onChange: () => undefined,
        tools: createElement('span', null, 'Undo Tool')
      })
    );
    assert.ok(html.includes('Undo Tool') && html.includes('Add Comment'));
  });
});

describe('selectionOf', () => {
  it('splits the selection into graph nodes and comment frames, skipping ghosts', () => {
    const node = (id: string, selected: boolean, ghost = false) => ({
      id,
      type: 'graph' as const,
      position: { x: 0, y: 0 },
      selected,
      data: { ghost } as never
    });
    const picked = selectionOf([
      node('a', true),
      node('b', false),
      node('removed:c', true, true),
      {
        id: 'comment:comment1',
        type: 'comment' as const,
        position: { x: 0, y: 0 },
        selected: true,
        data: {
          comment: {
            id: 'comment1',
            text: '',
            position: { x: 0, y: 0 },
            size: { width: 1, height: 1 }
          }
        }
      }
    ]);
    assert.deepEqual(picked, { nodes: ['a'], comments: ['comment1'] });
  });
});

describe('openingNodes', () => {
  it('opens wide graphs at their start so nodes stay readable', () => {
    const nodes = [
      { id: 'b', position: { x: 300 } },
      { id: 'a', position: { x: -100 } },
      { id: 'far', position: { x: OPENING_WIDTH } }
    ];
    assert.deepEqual(openingNodes(nodes), [{ id: 'b' }, { id: 'a' }]);
  });
});

describe('nodeClicks', () => {
  it('waits out a double-click before selecting a node that opens, so opening it is not blocked', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const selected: string[] = [];
    const opened: string[] = [];
    const clicks = nodeClicks({
      onSelect: (id) => void selected.push(id),
      onOpen: (id) => void opened.push(id),
      delayMs: 5
    });
    clicks.click('plain', false);
    assert.deepEqual(selected, ['plain']);
    clicks.click('block', true);
    clicks.doubleClick('block', true);
    t.mock.timers.tick(20);
    assert.deepEqual([selected, opened], [['plain'], ['block']]);
    clicks.click('block', true);
    t.mock.timers.tick(4);
    assert.deepEqual(selected, ['plain']);
    t.mock.timers.tick(1);
    assert.deepEqual(selected, ['plain', 'block']);
    clicks.doubleClick('plain', false);
    assert.deepEqual(opened, ['block']);
  });

  it('selects only the last of two quick clicks, and not at all once cancelled', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const selected: string[] = [];
    const clicks = nodeClicks({
      onSelect: (id) => void selected.push(id),
      onOpen: () => undefined
    });
    clicks.click('a', true);
    clicks.click('b', true);
    t.mock.timers.tick(1000);
    assert.deepEqual(selected, ['b']);
    clicks.click('c', true);
    clicks.cancel();
    t.mock.timers.tick(1000);
    assert.deepEqual(selected, ['b']);
  });

  it('selects at once when nothing can be opened', () => {
    const selected: string[] = [];
    nodeClicks({ onSelect: (id) => void selected.push(id) }).click('block', true);
    assert.deepEqual(selected, ['block']);
  });
});
