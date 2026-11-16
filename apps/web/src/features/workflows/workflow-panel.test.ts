import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { GraphDef } from '@ugula/graph';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { exitsOf, freeName, WorkflowPanel, withDoc, withExits } from './workflow-panel.tsx';

const def: GraphDef = {
  signature: {
    execIn: ['exec'],
    execOut: ['ok', 'rejected'],
    inputs: [{ name: 'claim', type: { object: { id: 'string' } }, label: 'Claim' }],
    outputs: [{ name: 'total', type: 'number' }],
    exits: { rejected: { label: 'Rejected', description: 'The payer said no' } }
  },
  variables: [{ name: 'lines', type: { list: 'string' }, default: [] }],
  nodes: [],
  edges: []
};

const render = (editable: boolean, locked: string | null = null) =>
  renderToStaticMarkup(
    createElement(WorkflowPanel, {
      kind: 'workflow',
      def,
      editable,
      locked,
      onChange: () => undefined,
      onVariableNode: editable ? () => undefined : undefined,
      onClose: () => undefined
    })
  );

describe('WorkflowPanel', () => {
  it('edits inputs, outputs, exits and variables with structured controls', () => {
    const html = render(true);
    assert.ok(html.startsWith('<aside') && html.includes('Inputs and Outputs</h2>'));
    assert.ok(html.includes('aria-label="Close Inputs and Outputs"'));
    for (const title of ['>Inputs<', '>Outputs<', '>Exits<', '>Variables<']) {
      assert.ok(html.includes(title), title);
    }
    assert.ok(html.includes('value="claim"') && html.includes('value="total"'));
    assert.ok(html.includes('value="rejected"') && html.includes('value="The payer said no"'));
    assert.ok(html.includes('>Record<') && !html.includes('object{'));
    assert.ok(
      html.includes('Add Input') && html.includes('Add Exit') && html.includes('Add Variable')
    );
    assert.ok(html.includes('aria-label="Move claim down"'));
    assert.ok(html.includes('Add Get lines') && html.includes('Add Set lines'));
    assert.ok(html.includes('Runs as a Step'));
  });

  it('is read-only with the reason when the contract is fixed', () => {
    const html = render(false, 'A copy keeps the inputs and outputs of the built-in.');
    assert.ok(html.includes('<fieldset disabled'));
    assert.ok(html.includes('A copy keeps the inputs and outputs of the built-in.'));
    assert.ok(!html.includes('Add Input') && !html.includes('Remove claim'));
    assert.ok(!html.includes('Add Get'));
  });
});

describe('workflow panel helpers', () => {
  it('turns exits into rows and back, keeping only real docs', () => {
    const rows = exitsOf(def.signature);
    assert.deepEqual(rows, [
      { name: 'ok' },
      { name: 'rejected', label: 'Rejected', description: 'The payer said no' }
    ]);
    const next = withExits(def.signature, [{ name: 'done', label: '' }, ...rows.slice(1)]);
    assert.deepEqual(next.execOut, ['done', 'rejected']);
    assert.deepEqual(Object.keys(next.exits ?? {}), ['rejected']);
    assert.equal('exits' in withExits(def.signature, [{ name: 'ok' }]), false);
  });

  it('sets a doc field or drops it when cleared, and finds free names', () => {
    assert.deepEqual(withDoc({ name: 'a', label: 'A' }, 'description', 'About a'), {
      name: 'a',
      label: 'A',
      description: 'About a'
    });
    assert.deepEqual(withDoc({ name: 'a', label: 'A' }, 'label', ' '), { name: 'a' });
    assert.equal(freeName('exit', ['exit2']), 'exit3');
    assert.equal(freeName('var', ['var1', 'var2']), 'var3');
  });
});
