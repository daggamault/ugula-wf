import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ENTRY_TYPE, type GraphDef } from '@ugula/graph';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createCatalog } from '../../shared/graph/catalog.ts';
import { idleLive, testNodes } from '../../shared/testing.ts';
import type { GraphDetail, GraphScope, WorkflowsClient } from './client.ts';
import {
  DocumentationHints,
  documentationHints,
  EditorPage,
  EditorView,
  leavingHref
} from './editor-page.tsx';
import type { TrailStep } from './trail.ts';

const source: GraphDef = {
  signature: { execIn: ['exec'], execOut: [], inputs: [], outputs: [] },
  variables: [],
  nodes: [{ id: 'entry', type: ENTRY_TYPE, version: 1 }],
  edges: []
};

const detail = (
  scope: GraphScope,
  published: boolean,
  links: { overridden_by?: string; overrides?: string } = {}
): GraphDetail => ({
  graph: {
    id: 'g1',
    scope,
    key: 'acme.flow',
    name: 'Flow',
    kind: 'workflow',
    description: '',
    overridden_by: links.overridden_by ?? null,
    overrides: links.overrides ?? null,
    is_stale: false,
    canEdit: scope !== 'system',
    canOverride: { organization: false, agency: scope === 'system' },
    effectiveId: links.overridden_by ?? 'g1'
  },
  versions: [
    {
      id: 'v2',
      version: 2,
      published_at: published ? '2026-01-01' : null,
      created_at: '2026-01-01',
      base_version: null,
      base_graph_id: null
    },
    {
      id: 'v1',
      version: 1,
      published_at: '2026-01-01',
      created_at: '2026-01-01',
      base_version: null,
      base_graph_id: null
    }
  ]
});

const render = (d: GraphDetail, version: number, trail: TrailStep[] = []) =>
  renderToStaticMarkup(
    createElement(EditorView, {
      detail: d,
      version,
      source,
      catalog: createCatalog(testNodes),
      client: {} as WorkflowsClient,
      trail,
      nameOf: (id) => ({ p1: 'Process PCR', p0: 'Ingest' })[id] ?? 'Workflow',
      onSaved: () => undefined
    })
  );

describe('EditorView', () => {
  it('lets agencies edit, save and publish drafts', () => {
    const html = render(detail('agency', false), 2);
    assert.ok(html.includes('Draft v2'));
    assert.ok(html.includes('>Save<'));
    assert.ok(html.includes('>Publish<'));
    assert.ok(html.includes('href="/runs/new?graph=g1"'));
    assert.ok(html.includes('Add Node') && html.includes('Workflow Settings'));
    assert.ok(html.includes('Drag from one pin to another'));
    assert.ok(html.includes('href="/?panel=settings"') && !html.includes('<dialog open'));
    assert.ok(html.includes('No changes to save.') && !html.includes('Save your changes first.'));
    assert.ok(html.includes('aria-label="Version"'));
    assert.ok(html.includes('<option value="2" selected="">v2 (Draft)</option>'));
    assert.ok(html.includes('<option value="1">v1</option>'));
  });

  it('points published versions at the open draft instead of offering a new one', () => {
    const html = render(detail('agency', false), 1);
    assert.ok(html.includes('Published v1') && !html.includes('Edit as New Draft'));
    assert.ok(html.includes('Published versions are read-only. Open draft v2 to make changes.'));
    assert.ok(!html.includes('>Save<'));
  });

  it('offers a new draft from published versions and locks system graphs', () => {
    const published = render(detail('agency', true), 2);
    assert.ok(published.includes('Edit as New Draft'));
    assert.ok(!published.includes('>Publish<'));
    assert.ok(!published.includes('Add Node'));
    assert.ok(published.includes('Published versions are read-only. Edit as a new draft'));
    const system = render(detail('system', true), 1);
    assert.ok(system.includes('System'));
    assert.ok(!system.includes('Edit as New Draft'));
    assert.ok(system.includes('>Override<'));
    assert.ok(system.includes('Override this one to change how your agency runs it'));
  });

  it('links a built-in graph to its override, and lets the override be removed', () => {
    const overridden = render(detail('system', true, { overridden_by: 'g9' }), 1);
    assert.ok(overridden.includes('>Has Your Copy<'));
    assert.ok(overridden.includes('href="/workflows/g9"') && overridden.includes('Edit Override'));
    assert.ok(!overridden.includes('>Override<'));
    const copy = render(detail('agency', false, { overrides: 'g0' }), 2);
    assert.ok(copy.includes('>Your Copy<') && copy.includes('Remove Override'));
    assert.ok(copy.includes('>Publish<'));
  });

  it('shows where a sub-workflow was opened from and leads back up', () => {
    const top = render(detail('agency', true), 2);
    assert.ok(!top.includes('aria-label="Workflow path"'));
    assert.ok(top.includes('href="/workflows"') && top.includes('aria-label="Back to Workflows"'));
    const nested = render(detail('agency', true), 2, [
      { graphId: 'p0', version: 1 },
      { graphId: 'p1', version: 3 }
    ]);
    assert.ok(nested.includes('aria-label="Workflow path"'));
    assert.ok(nested.includes('href="/workflows/p0?version=1"'));
    assert.ok(nested.includes('href="/workflows/p1?version=3&amp;trail=p0:1"'));
    assert.ok(nested.includes('aria-label="Back to Process PCR"'));
  });
});

describe('EditorPage', () => {
  it('waits for the graph before rendering', () => {
    const html = renderToStaticMarkup(
      createElement(EditorPage, {
        live: idleLive,
        client: {
          find: async () => detail('agency', false),
          nodes: async () => [],
          version: async () => ({ id: 'v2', version: 2, definition: source, published_at: null })
        } as unknown as WorkflowsClient,
        nodes: testNodes,
        graphId: 'g1',
        version: null,
        trail: []
      })
    );
    assert.ok(html.includes('aria-label="Loading"'));
  });
});

describe('documentation hints', () => {
  it('names the node a hint is about and shows them as a warning to expand', () => {
    const def: GraphDef = {
      ...source,
      signature: { ...source.signature, inputs: [{ name: 'x', type: 'number' }] },
      nodes: [{ id: 'entry', type: ENTRY_TYPE, version: 1, label: 'go here' }]
    };
    const hints = documentationHints(def, createCatalog(testNodes));
    assert.deepEqual(hints, [
      'Describe the input "x"',
      'Entry: Write the label "go here" in Title Case'
    ]);
    const html = renderToStaticMarkup(createElement(DocumentationHints, { hints }));
    assert.ok(html.includes('<details') && html.includes('2 Documentation Hints'));
    assert.ok(render(detail('agency', false), 2).includes('Documentation Hint') === false);
  });
});

describe('leavingHref', () => {
  it('only catches plain clicks on links that leave the editor', () => {
    const plain = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false };
    const link = (href: string | null) =>
      ({ closest: () => (href ? { getAttribute: () => href } : null) }) as unknown as Element;
    assert.equal(leavingHref(link('/workflows'), '/workflows/g1', plain), '/workflows');
    assert.equal(leavingHref(link('/workflows/g1?panel=settings'), '/workflows/g1', plain), null);
    assert.equal(leavingHref(link('/runs'), '/workflows/g1', { ...plain, ctrlKey: true }), null);
    assert.equal(leavingHref(link(null), '/workflows/g1', plain), null);
  });
});
