import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ENTRY_TYPE, type GraphDef } from '@ugula/graph';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createCatalog } from '../../shared/graph/catalog.ts';
import type { GraphDetail, WorkflowsClient } from './client.ts';
import { EditorPage, EditorView } from './editor-page.tsx';
import type { TrailStep } from './trail.ts';

const source: GraphDef = {
  signature: { execIn: ['exec'], execOut: [], inputs: [], outputs: [] },
  variables: [],
  nodes: [{ id: 'entry', type: ENTRY_TYPE, version: 1 }],
  edges: []
};

const detail = (
  tenant: string | null,
  published: boolean,
  links: { overridden_by?: string; overrides?: string } = {}
): GraphDetail => ({
  graph: {
    id: 'g1',
    tenant_id: tenant,
    key: 'acme.flow',
    name: 'Flow',
    kind: 'workflow',
    description: '',
    overridden_by: links.overridden_by ?? null,
    overrides: links.overrides ?? null
  },
  versions: [
    {
      id: 'v2',
      version: 2,
      published_at: published ? '2026-01-01' : null,
      created_at: '2026-01-01'
    },
    { id: 'v1', version: 1, published_at: '2026-01-01', created_at: '2026-01-01' }
  ]
});

const render = (d: GraphDetail, version: number, trail: TrailStep[] = []) =>
  renderToStaticMarkup(
    createElement(EditorView, {
      detail: d,
      version,
      source,
      catalog: createCatalog(),
      client: {} as WorkflowsClient,
      trail,
      nameOf: (id) => ({ p1: 'Process PCR', p0: 'Ingest' })[id] ?? 'Workflow',
      onSaved: () => undefined
    })
  );

describe('EditorView', () => {
  it('lets tenants edit, save and publish drafts', () => {
    const html = render(detail('t-1', false), 2);
    assert.ok(html.includes('Draft v2'));
    assert.ok(html.includes('>Save<'));
    assert.ok(html.includes('>Publish<'));
    assert.ok(html.includes('href="/runs/new?graph=g1"'));
    assert.ok(html.includes('Add node') && html.includes('Graph settings'));
    assert.ok(html.includes('Drag from one pin to another'));
  });

  it('offers a new draft from published versions and locks system graphs', () => {
    const published = render(detail('t-1', true), 2);
    assert.ok(published.includes('Edit as new draft'));
    assert.ok(!published.includes('>Publish<'));
    assert.ok(!published.includes('Add node'));
    assert.ok(published.includes('Published versions are read-only. Edit as a new draft'));
    const system = render(detail(null, true), 1);
    assert.ok(system.includes('System'));
    assert.ok(!system.includes('Edit as new draft'));
    assert.ok(system.includes('>Override<'));
    assert.ok(system.includes('Override one to change how your agency runs it'));
  });

  it('links a built-in graph to its override, and lets the override be removed', () => {
    const overridden = render(detail(null, true, { overridden_by: 'g9' }), 1);
    assert.ok(overridden.includes('Overridden'));
    assert.ok(overridden.includes('href="/workflows/g9"') && overridden.includes('Edit override'));
    assert.ok(!overridden.includes('>Override<'));
    const copy = render(detail('t-1', false, { overrides: 'g0' }), 2);
    assert.ok(copy.includes('>Override<') && copy.includes('Remove override'));
    assert.ok(copy.includes('>Publish<'));
  });

  it('shows where a sub-workflow was opened from and leads back up', () => {
    const top = render(detail('t-1', true), 2);
    assert.ok(!top.includes('aria-label="Workflow path"'));
    assert.ok(top.includes('href="/workflows"') && top.includes('aria-label="Back to Workflows"'));
    const nested = render(detail('t-1', true), 2, [
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
        client: {
          find: async () => detail('t-1', false),
          nodes: async () => [],
          version: async () => ({ id: 'v2', version: 2, definition: source, published_at: null })
        } as unknown as WorkflowsClient,
        graphId: 'g1',
        version: null,
        trail: []
      })
    );
    assert.ok(html.includes('aria-label="Loading"'));
  });
});
