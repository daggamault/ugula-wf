import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ReactFlowProvider } from '@xyflow/react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { GraphNodeData } from './flow.ts';
import { GraphNode, pinTitle } from './graph-node.tsx';

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
  opens: null,
  change: null,
  ghost: false
};

describe('GraphNode', () => {
  it('renders typed pins with handles and literal previews for unconnected inputs', () => {
    const html = render(base);
    assert.ok(html.includes('aria-label="Add"'));
    assert.ok(html.includes('data-handleid="a"'));
    assert.ok(html.includes('data-handleid="failed"'));
    assert.ok(html.includes('title="A: Number"'));
    assert.ok(html.includes('title="Execution flow"'));
    assert.ok(html.includes('Adds two numbers (a + b).'));
    assert.ok(html.includes('>12<'));
    assert.ok(!html.includes('total * 2'));
    assert.ok(html.includes('bg-pin-number'));
  });

  it('shows status, issues, sub-graph badges and unknown nodes', () => {
    const html = render(
      { ...base, status: 'error', issues: ['Bad', 'Worse'], opens: 'graph' },
      true
    );
    assert.ok(html.includes('border-danger'));
    assert.ok(html.includes('Bad (+1)'));
    assert.ok(html.includes('Subworkflow'));
    assert.ok(html.includes('ring-2'));
    assert.ok(render({ ...base, signature: null }).includes('Unknown node std.math.add@1'));
  });

  it('documents pins and exits in tooltips and shows the node note', () => {
    const html = render({
      ...base,
      instance: { ...base.instance, note: 'Ask billing first' },
      signature: {
        execIn: [],
        execOut: ['failed'],
        inputs: [{ name: 'a', type: 'number', description: 'The first number' }],
        outputs: [],
        exits: { failed: { label: 'Gave Up', description: 'Every retry failed' } }
      }
    });
    assert.ok(html.includes('title="A: Number. The first number"'));
    assert.ok(html.includes('title="Gave Up: Execution flow. Every retry failed"'));
    assert.ok(html.includes('>Gave Up<'));
    assert.ok(html.includes('Ask billing first'));
    assert.equal(pinTitle({ name: 'then', label: '', exec: true }), 'Execution flow');
  });

  it('outlines customized nodes and dims removed ones', () => {
    const custom = render({ ...base, change: 'changed' });
    assert.ok(custom.includes('border-custom') && custom.includes('>Custom<'));
    assert.ok(!render(base).includes('border-custom'));
    const ghost = render({ ...base, ghost: true });
    assert.ok(ghost.includes('border-dashed') && ghost.includes('>Removed<'));
    assert.ok(ghost.includes('aria-label="Add (removed)"'));
    assert.ok(render({ ...base, change: 'added', status: 'error' }).includes('border-danger'));
  });

  it('previews unwired expressions and shortens long literals', () => {
    const html = render({
      ...base,
      connected: [],
      instance: {
        ...base.instance,
        inputs: { a: { value: 'a long literal value' }, b: { expr: 'total * 2' } }
      }
    });
    assert.ok(html.includes('&quot;a long literal v…'));
    assert.ok(html.includes('= total * 2'));
    assert.ok(html.includes('>Failed<') && !html.includes('>Then<'));
  });
});
