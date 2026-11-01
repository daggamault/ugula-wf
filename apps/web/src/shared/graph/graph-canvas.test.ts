import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ENTRY_TYPE } from '@ugula/graph';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createCatalog } from './catalog.ts';
import { GraphCanvas, OPENING_WIDTH, openingNodes } from './graph-canvas.tsx';

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
        catalog: createCatalog(),
        selected: null,
        onSelect: () => undefined
      })
    );
    assert.ok(html.includes('react-flow'));
    assert.ok(html.includes('min-h-96'));
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
