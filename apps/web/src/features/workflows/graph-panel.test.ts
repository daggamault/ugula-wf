import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { GraphDef } from '@ugula/graph';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GraphPanel } from './graph-panel.tsx';

const def: GraphDef = {
  signature: {
    execIn: ['exec'],
    execOut: ['ok', 'rejected'],
    inputs: [{ name: 'claim', type: { object: { id: 'string' } } }],
    outputs: [{ name: 'total', type: 'number' }]
  },
  variables: [{ name: 'lines', type: { list: 'string' }, default: [] }],
  nodes: [],
  edges: []
};

describe('GraphPanel', () => {
  it('shows signature pins, exec pins, variables and graph issues', () => {
    const html = renderToStaticMarkup(
      createElement(GraphPanel, {
        def,
        issues: [{ message: 'Add an Entry node so execution can start' }],
        editable: true,
        onChange: () => undefined
      })
    );
    assert.ok(html.includes('value="ok, rejected"'));
    assert.ok(html.includes('value="object{id: string}"'));
    assert.ok(html.includes('value="total"'));
    assert.ok(html.includes('value="lines"'));
    assert.ok(html.includes('Add input'));
    assert.ok(html.includes('Add an Entry node'));
  });
});
