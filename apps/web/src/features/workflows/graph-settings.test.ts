import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { GraphDef } from '@ugula/graph';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GraphSettings } from './graph-settings.tsx';

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

const render = (editable: boolean) =>
  renderToStaticMarkup(
    createElement(GraphSettings, {
      kind: 'workflow',
      open: true,
      def,
      editable,
      onChange: () => undefined,
      onClose: () => undefined
    })
  );

describe('GraphSettings', () => {
  it('edits paths, inputs, outputs and variables in one explained dialog', () => {
    const html = render(true);
    assert.ok(html.includes('Workflow Settings'));
    assert.ok(html.includes('value="ok, rejected"'));
    assert.ok(html.includes('value="object{id: string}"'));
    assert.ok(html.includes('value="total"'));
    assert.ok(html.includes('value="lines"'));
    assert.ok(html.includes('Add input') && html.includes('Add output'));
    assert.ok(html.includes('aria-label="Remove claim"') && html.includes('Remove</span>'));
  });

  it('locks every field in read-only graphs', () => {
    const html = render(false);
    assert.ok(html.includes('<fieldset disabled'));
    assert.ok(!html.includes('Add input') && !html.includes('Remove claim'));
  });
});
