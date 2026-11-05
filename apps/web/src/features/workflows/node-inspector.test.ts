import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ENTRY_TYPE, type GraphDef, type NodeInstance } from '@ugula/graph';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createCatalog } from '../../shared/graph/catalog.ts';
import { testNodes } from '../../shared/testing.ts';
import type { EffectiveTable } from './client.ts';
import { NodeInspector } from './node-inspector.tsx';

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
    { id: 'add1', type: 'std.math.add', version: 1, inputs: { a: { value: 2 } } },
    { id: 'round1', type: 'std.math.round', version: 1 },
    { id: 'expr1', type: 'std.expr', version: 1, config: { expression: 'a + 1' } }
  ],
  edges: [
    { from: 'entry', fromPin: 'exec', to: 'delay1', toPin: 'exec' },
    { from: 'add1', fromPin: 'result', to: 'round1', toPin: 'value' }
  ]
};

const render = (id: string, editable = true, onOpen?: () => void) =>
  renderToStaticMarkup(
    createElement(NodeInspector, {
      def,
      node: def.nodes.find((n) => n.id === id) ?? { id, type: 'x', version: 1 },
      catalog: createCatalog(testNodes),
      editable,
      onChange: () => undefined,
      onDelete: () => undefined,
      onOpen,
      onClose: () => undefined
    })
  );

describe('NodeInspector', () => {
  it('explains what a step does, how its inputs are set and where it goes next', () => {
    const html = render('delay1');
    assert.ok(html.includes('Delay</h2>'));
    assert.ok(html.includes('Durably waits'));
    assert.ok(html.includes('value="wait * 1000"'));
    assert.ok(html.includes('Whole Number'));
    assert.ok(html.includes('Not connected'));
    assert.ok(html.includes('Retry on Failure') && html.includes('value="500"'));
    assert.ok(!html.includes('Settings (JSON)'));
    assert.ok(html.includes('Delete Node'));
    assert.ok(html.includes('aria-label="Close"'));
  });

  it('names where connected inputs come from and who uses each output', () => {
    assert.ok(render('round1').includes('From Add (result)'));
    const add = render('add1');
    assert.ok(add.includes('Round'));
    assert.ok(add.includes('Needs a value: connect a pin on the canvas, or set one here.'));
    assert.ok(!add.includes('Retry on Failure'));
    assert.match(
      add,
      /role="option"[^>]*aria-selected="true" data-value="value"[^>]*><span[^>]*>A Fixed Value<\/span>/
    );
    assert.ok(add.includes('>Fixed Value<') && add.includes('value="2"'));
  });

  it('offers to open the workflow a node starts only when it can be opened', () => {
    assert.ok(!render('delay1').includes('Open Workflow'));
    assert.ok(render('delay1', true, () => undefined).includes('Open Workflow'));
  });

  it('shows settings only for nodes that take them', () => {
    assert.ok(render('expr1').includes('Settings (JSON)'));
  });

  it('shows pin and exit documentation and the node note', () => {
    const rule = { id: 'rule1', type: 'acme.rule', version: 1, note: 'Check with billing' };
    const html = (editable: boolean) =>
      renderToStaticMarkup(
        createElement(NodeInspector, {
          def: { ...def, nodes: [...def.nodes, rule] },
          node: rule,
          catalog: createCatalog(testNodes, {
            published: [
              {
                graph_id: 'g1',
                key: 'acme.rule',
                name: 'Rule',
                kind: 'node',
                role: 'rule',
                overridden: false,
                description: '',
                version: 1,
                signature: {
                  execIn: ['exec'],
                  execOut: ['held'],
                  inputs: [{ name: 'claim', type: 'any', description: 'The claim to check' }],
                  outputs: [],
                  exits: { held: { label: 'On Hold', description: 'A biller holds it' } }
                }
              }
            ]
          }),
          editable,
          onChange: () => undefined,
          onDelete: () => undefined,
          onClose: () => undefined
        })
      );
    const edit = html(true);
    assert.ok(edit.includes('The claim to check'));
    assert.ok(edit.includes('On Hold') && edit.includes('A biller holds it'));
    assert.ok(edit.includes('Name and Note') && edit.includes('Check with billing</textarea>'));
    const read = html(false);
    assert.ok(read.includes('Check with billing</p>') && !read.includes('<textarea'));
  });

  it('locks every field and hides delete in read-only graphs, and never deletes the start', () => {
    const html = render('add1', false);
    assert.ok(html.includes('disabled'));
    assert.ok(!html.includes('Delete Node'));
    assert.ok(!render('entry').includes('Delete Node'));
    assert.ok(render('entry').includes('Where this graph starts'));
  });

  const inspect = (
    node: NodeInstance,
    extra: { base?: NodeInstance; table?: EffectiveTable } = {},
    editable = true
  ) =>
    renderToStaticMarkup(
      createElement(NodeInspector, {
        def: { ...def, nodes: [...def.nodes.filter((n) => n.id !== node.id), node] },
        node,
        catalog: createCatalog(testNodes),
        editable,
        onChange: () => undefined,
        onDelete: () => undefined,
        onClose: () => undefined,
        ...extra
      })
    );

  it('shows what an override changed with the base value and a reset', () => {
    const node = { id: 'add1', type: 'std.math.add', version: 1, inputs: { a: { value: 5 } } };
    const html = inspect(node, { base: { ...node, inputs: { a: { value: 2 } } } });
    assert.ok(html.includes('Changed From Base') && html.includes('Base: 2'));
    assert.ok(html.includes('Reset to Base') && html.includes('bg-custom'));
    assert.ok(html.includes('aria-label="Changed from the base"'));
    assert.ok(!inspect(node, { base: node }).includes('Changed From Base'));
    assert.ok(!inspect(node, { base: { ...node, inputs: {} } }, false).includes('Reset to Base'));
  });

  it('links a table node to its shared table and says when it is customized', () => {
    const node = {
      id: 'rates',
      type: 'std.table.lookup',
      version: 1,
      config: { type: 'string', table: { key: 'billing.rates' } }
    };
    const html = inspect(node, {
      table: { id: 't1', key: 'billing.rates', name: 'Rates', scope: 'agency' }
    });
    assert.ok(html.includes('Uses the shared table') && html.includes('href="/tables/t1"'));
    assert.ok(html.includes('Customized for This Agency'));
    assert.ok(inspect(node).includes('This table is not available to your agency.'));
  });
});
