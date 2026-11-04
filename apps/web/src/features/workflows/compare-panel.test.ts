import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ENTRY_TYPE, type GraphDef } from '@ugula/graph';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ComparePanel } from './compare-panel.tsx';

const then: GraphDef = {
  signature: { execIn: ['exec'], execOut: [], inputs: [], outputs: [] },
  variables: [],
  nodes: [{ id: 'entry', type: ENTRY_TYPE, version: 1 }],
  edges: []
};

const now: GraphDef = {
  ...then,
  nodes: [...then.nodes, { id: 'rate', type: 'std.math.add', version: 1 }]
};

const mine: GraphDef = {
  ...then,
  nodes: [...then.nodes, { id: 'fee', type: 'std.math.add', version: 1, label: 'County Fee' }]
};

const render = (canEdit: boolean, baseChanged = true) =>
  renderToStaticMarkup(
    createElement(ComparePanel, {
      comparison: {
        mine: { version: 2, definition: mine },
        copiedFrom: { version: 1, definition: then, scope: 'system' },
        latest: { version: 2, definition: now },
        baseChanged
      },
      current: mine,
      noun: 'subworkflow',
      titleOf: (n) => n.label ?? n.id,
      canEdit,
      busy: false,
      onKeep: () => undefined,
      onReset: () => undefined,
      onClose: () => undefined
    })
  );

describe('ComparePanel', () => {
  it('lists the base then, what the base changed since and what you changed', () => {
    const html = render(true);
    assert.ok(html.includes('Base Then') && html.includes('built-in subworkflow v1'));
    assert.ok(html.includes('Base Now') && html.includes('Added rate'));
    assert.ok(html.includes('Yours') && html.includes('Added County Fee'));
    assert.ok(html.includes('Keep Mine') && html.includes('Start From Base'));
  });

  it('says when the base is unchanged and hides actions from readers', () => {
    const html = render(false, false);
    assert.ok(html.includes('The base has not changed since you copied it.'));
    assert.ok(!html.includes('Keep Mine'));
  });
});
