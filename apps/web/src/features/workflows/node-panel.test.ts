import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ENTRY_TYPE, type GraphDef } from '@ugula/graph';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createCatalog } from '../../shared/graph/catalog.ts';
import { NodePanel } from './node-panel.tsx';

const def: GraphDef = {
  signature: { execIn: ['exec'], execOut: [], inputs: [], outputs: [] },
  variables: [],
  nodes: [
    { id: 'entry', type: ENTRY_TYPE, version: 1 },
    {
      id: 'delay1',
      type: 'std.flow.delay',
      version: 1,
      inputs: { ms: { expr: 'wait * 1000' } },
      retry: { max: 3, delayMs: 500 }
    },
    { id: 'add1', type: 'std.math.add', version: 1, inputs: { a: { value: 2 } } }
  ],
  edges: [{ from: 'entry', fromPin: 'exec', to: 'delay1', toPin: 'exec' }]
};

const render = (id: string, editable = true) =>
  renderToStaticMarkup(
    createElement(NodePanel, {
      def,
      node: def.nodes.find((n) => n.id === id) ?? { id, type: 'x', version: 1 },
      catalog: createCatalog(),
      editable,
      onChange: () => undefined,
      onDelete: () => undefined
    })
  );

describe('NodePanel', () => {
  it('edits bindings, config and retry for action nodes', () => {
    const html = render('delay1');
    assert.ok(html.includes('Delay'));
    assert.ok(html.includes('Durably waits'));
    assert.ok(html.includes('value="wait * 1000"'));
    assert.ok(html.includes('Retry on failure'));
    assert.ok(html.includes('value="500"'));
    assert.ok(html.includes('Configuration'));
    assert.ok(html.includes('Delete node'));
  });

  it('explains defaults for pure nodes and locks read-only views', () => {
    const html = render('add1', false);
    assert.ok(html.includes('Required: connect a pin or set a value'));
    assert.ok(!html.includes('Retry on failure'));
    assert.ok(html.includes('disabled'));
    assert.ok(!render('entry').includes('Delete node'));
  });
});
