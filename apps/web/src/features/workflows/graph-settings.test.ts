import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { GraphDef } from '@ugula/graph';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GraphSettings, withDoc } from './graph-settings.tsx';

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

const render = (editable: boolean, kind: 'workflow' | 'node' = 'workflow') =>
  renderToStaticMarkup(
    createElement(GraphSettings, {
      kind,
      def,
      editable,
      onChange: () => undefined,
      onClose: () => undefined
    })
  );

describe('GraphSettings', () => {
  it('edits paths, inputs, outputs and variables in one explained side panel', () => {
    const html = render(true);
    assert.ok(html.includes('Workflow Settings') && html.startsWith('<aside'));
    assert.ok(html.includes('aria-label="Close Settings"') && !html.includes('<dialog'));
    assert.ok(html.includes('value="ok, rejected"'));
    assert.ok(html.includes('value="object{id: string}"'));
    assert.ok(html.includes('value="total"'));
    assert.ok(html.includes('value="lines"'));
    assert.ok(html.includes('Add Input') && html.includes('Add Output'));
    assert.ok(html.includes('>Ways In<') && html.includes('>Starts As<'));
    assert.ok(html.includes('aria-label="Remove claim"'));
  });

  it('locks every field in read-only graphs', () => {
    const html = render(false);
    assert.ok(html.includes('<fieldset disabled'));
    assert.ok(!html.includes('Add Input') && !html.includes('Remove claim'));
  });

  it('titles the panel for subworkflows and labels its sections', () => {
    const html = render(true, 'node');
    assert.ok(html.includes('Subworkflow Settings</h2>') && html.includes('aria-labelledby='));
    assert.ok(html.includes('for="exec-in"') && html.includes('value="exec"'));
    assert.ok(html.includes('aria-label="Remove lines"') && html.includes('Add Variable'));
  });
});

describe('pin and exit documentation', () => {
  it('edits labels and descriptions of pins and exits', () => {
    const html = renderToStaticMarkup(
      createElement(GraphSettings, {
        kind: 'node',
        def: {
          ...def,
          signature: {
            ...def.signature,
            inputs: [{ name: 'claim', type: 'any', label: 'Claim', description: 'The claim' }],
            exits: { rejected: { label: 'Rejected', description: 'The payer said no' } }
          }
        },
        editable: true,
        onChange: () => undefined,
        onClose: () => undefined
      })
    );
    assert.ok(html.includes('>Exits<') && html.includes('id="exit-ok-label"'));
    assert.ok(html.includes('value="The payer said no"'));
    assert.ok(html.includes('id="in-0-description"') && html.includes('value="The claim"'));
  });

  it('sets a doc field or drops it when cleared', () => {
    assert.deepEqual(withDoc({ name: 'a', label: 'A' }, 'description', 'About a'), {
      name: 'a',
      label: 'A',
      description: 'About a'
    });
    assert.deepEqual(withDoc({ name: 'a', label: 'A' }, 'label', ' '), { name: 'a' });
  });
});
