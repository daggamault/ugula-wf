import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ReactFlowProvider } from '@xyflow/react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { GraphNodeData } from './flow.ts';
import { GraphNode } from './graph-node.tsx';

const render = (data: GraphNodeData, selected = false) =>
  renderToStaticMarkup(
    createElement(ReactFlowProvider, {
      children: createElement(GraphNode, {
        id: 'n',
        data,
        selected,
        type: 'graph',
        dragging: false,
        zIndex: 0,
        isConnectable: true,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
        draggable: true,
        selectable: true,
        deletable: true
      })
    })
  );

const base: GraphNodeData = {
  instance: {
    id: 'n',
    type: 'std.math.add',
    version: 1,
    inputs: { a: { value: 12 }, b: { expr: 'total * 2' } }
  },
  title: 'Add',
  description: 'Adds two numbers (a + b).',
  signature: {
    execIn: ['exec'],
    execOut: ['then', 'failed'],
    inputs: [
      { name: 'a', type: 'number' },
      { name: 'b', type: 'number' }
    ],
    outputs: [{ name: 'result', type: 'number' }]
  },
  connected: ['b'],
  status: 'idle',
  issues: [],
  opens: null
};

describe('GraphNode', () => {
  it('renders typed pins with handles and literal previews for unconnected inputs', () => {
    const html = render(base);
    assert.ok(html.includes('aria-label="Add"'));
    assert.ok(html.includes('data-handleid="a"'));
    assert.ok(html.includes('data-handleid="failed"'));
    assert.ok(html.includes('title="a: Number"'));
    assert.ok(html.includes('title="Execution flow"'));
    assert.ok(html.includes('Adds two numbers (a + b).'));
    assert.ok(html.includes('>12<'));
    assert.ok(!html.includes('total * 2'));
    assert.ok(html.includes('bg-emerald-500'));
  });

  it('shows status, issues, sub-graph badges and unknown nodes', () => {
    const html = render(
      { ...base, status: 'error', issues: ['Bad', 'Worse'], opens: 'graph' },
      true
    );
    assert.ok(html.includes('border-danger'));
    assert.ok(html.includes('Bad (+1)'));
    assert.ok(html.includes('Building block'));
    assert.ok(html.includes('ring-2'));
    assert.ok(render({ ...base, signature: null }).includes('Unknown node std.math.add@1'));
  });
});
