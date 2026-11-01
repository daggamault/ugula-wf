import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { GraphSummary, WorkflowsClient } from './client.ts';
import { matchesFilter, WorkflowsPage, WorkflowsTable } from './workflows-page.tsx';

const graph = (patch: Partial<GraphSummary>): GraphSummary => ({
  id: 'g1',
  key: 'demo.batch',
  name: 'Batch',
  kind: 'workflow',
  description: '',
  isSystem: false,
  overrides: false,
  overriddenBy: null,
  publishedVersion: 2,
  draftVersion: null,
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...patch
});

describe('WorkflowsPage', () => {
  it('lists graphs with kind, versions and run links for published workflows', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowsTable, {
        graphs: [
          graph({}),
          graph({ id: 'g2', kind: 'node', isSystem: true, publishedVersion: null }),
          graph({ id: 'g3', kind: 'node', isSystem: true, overriddenBy: 'g4' }),
          graph({ id: 'g4', kind: 'node', overrides: true })
        ]
      })
    );
    assert.ok(html.includes('Overridden') && html.includes('>Override<'));
    assert.ok(html.includes('href="/workflows/g1"'));
    assert.ok(html.includes('href="/runs/new?graph=g1"'));
    assert.ok(!html.includes('/runs/new?graph=g2'));
    assert.ok(html.includes('System') && html.includes('Building block'));
    assert.ok(html.includes('v2'));
  });

  it('renders the page shell with a create action', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowsPage, {
        client: { list: async () => [] } as unknown as WorkflowsClient,
        show: 'all'
      })
    );
    assert.ok(html.includes('<h1'));
    assert.ok(html.includes('>New<'));
    assert.ok(html.includes('href="/workflows?show=blocks"'));
  });

  it('filters workflows, building blocks and graphs the agency owns', () => {
    const node = graph({ kind: 'node', isSystem: true });
    assert.equal(matchesFilter(graph({}), 'workflows'), true);
    assert.equal(matchesFilter(node, 'workflows'), false);
    assert.equal(matchesFilter(node, 'blocks'), true);
    assert.equal(matchesFilter(node, 'mine'), false);
    assert.equal(matchesFilter(graph({}), 'mine'), true);
    assert.equal(matchesFilter(node, 'all'), true);
  });
});
