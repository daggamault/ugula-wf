import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ENTRY_TYPE, type GraphDef } from '@ugula/graph';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createCatalog } from '../../shared/graph/catalog.ts';
import { testNodes } from '../../shared/testing.ts';
import { DocumentationHints, documentationHints, EditorNotices } from './editor-notices.tsx';

const def: GraphDef = {
  signature: {
    execIn: ['exec'],
    execOut: [],
    inputs: [{ name: 'x', type: 'number' }],
    outputs: []
  },
  variables: [],
  nodes: [{ id: 'entry', type: ENTRY_TYPE, version: 1, label: 'go here' }],
  edges: []
};

const notices = (props: Partial<Parameters<typeof EditorNotices>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(EditorNotices, {
      error: '',
      issues: [],
      hints: [],
      base: null,
      compareHref: '/?panel=compare',
      emptySlot: null,
      ...props
    })
  );

describe('documentation hints', () => {
  it('names the node a hint is about and shows them as a warning to expand', () => {
    const hints = documentationHints(def, createCatalog(testNodes));
    assert.deepEqual(hints, [
      'Describe the input "x"',
      'Entry: Write the label "go here" in Title Case'
    ]);
    const html = renderToStaticMarkup(createElement(DocumentationHints, { hints }));
    assert.ok(html.includes('<details') && html.includes('2 Documentation Hints'));
  });
});

describe('EditorNotices', () => {
  it('renders nothing without anything to say', () => {
    assert.equal(notices(), '');
  });

  it('explains a stale or updated base with a link to compare', () => {
    const stale = notices({ base: 'stale' });
    assert.ok(stale.includes('Base Updated.') && stale.includes('runs use the base'));
    assert.ok(stale.includes('href="/?panel=compare"'));
    assert.ok(notices({ base: 'updated' }).includes('Compare to see what changed.'));
  });

  it('tells how to fill an empty agency rule, the error and every graph issue', () => {
    assert.ok(notices({ emptySlot: 'system' }).includes('Override it for your agency'));
    const copy = notices({ emptySlot: 'copy' });
    assert.ok(copy.includes('Add nodes between') && !copy.includes('Override it'));
    const html = notices({ error: 'Boom', issues: [{ message: 'No return' }], hints: ['Fix x'] });
    assert.ok(html.includes('Boom') && html.includes('No return'));
    assert.ok(html.includes('1 Documentation Hint<'));
  });
});
