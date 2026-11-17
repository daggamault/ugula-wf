import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { valueKinds } from '@ugula/catalog';
import type { GraphDef, Json } from '@ugula/graph';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createCatalog } from '../../shared/graph/catalog.ts';
import { ValueKindsContext } from '../../shared/graph/pins.ts';
import { testNodes } from '../../shared/testing.ts';
import { againstOptions, ConditionEditor, rulesOf } from './condition-editor.tsx';

const def: GraphDef = {
  signature: { execIn: [], execOut: [], inputs: [], outputs: [] },
  variables: [],
  nodes: [],
  edges: []
};

const render = (config: Json) =>
  renderToStaticMarkup(
    createElement(
      ValueKindsContext.Provider,
      { value: valueKinds },
      createElement(ConditionEditor, {
        nodeId: 'c',
        config,
        editable: true,
        onConfig: () => undefined,
        def,
        catalog: createCatalog(testNodes)
      })
    )
  );

describe('ConditionEditor', () => {
  it('lays each rule out as an input, a test and a value', () => {
    const html = render({
      match: 'any',
      inputs: [
        { name: 'pickupState', type: 'string' },
        { name: 'emergency', type: 'boolean', label: 'Emergency Trip' }
      ],
      rules: [
        { field: 'pickupState', op: 'oneOf', value: ['NH', 'ME'] },
        { field: 'emergency', op: 'present' }
      ]
    });
    assert.match(html, /aria-selected="true" data-value="any"/);
    assert.ok(html.includes('>Emergency Trip</span>') && html.includes('>Has a Value</span>'));
    assert.ok(html.includes('value="NH, ME"') && html.includes('Separate items with commas.'));
    assert.equal(html.match(/>Value<\/label>/g)?.length, 1);
    assert.ok(html.includes('Add Rule'));
  });

  it('compares with another input in place of a value', () => {
    const html = render({
      inputs: [
        { name: 'count', type: 'integer' },
        { name: 'shown', type: 'integer' }
      ],
      rules: [{ field: 'count', op: 'gt', input: 'shown' }]
    });
    assert.ok(html.includes('>Compare with</label>') && !html.includes('>Value</label>'));
    assert.match(html, /aria-selected="true" data-value="shown"/);
    assert.deepEqual(
      againstOptions(['count', 'shown'], 'count', (n) => n.toUpperCase()),
      [
        { value: '', label: 'A Value' },
        { value: 'shown', label: 'SHOWN' }
      ]
    );
  });

  it('ignores malformed rules', () => {
    assert.deepEqual(rulesOf([{ field: 'a', op: 'is' }, null, { op: 'is' }] as Json), [
      { field: 'a', op: 'is' }
    ]);
  });
});
