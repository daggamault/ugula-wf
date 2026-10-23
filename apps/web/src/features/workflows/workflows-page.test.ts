import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { GraphSummary, WorkflowsClient } from './client.ts';
import { WorkflowsPage, WorkflowsTable } from './workflows-page.tsx';

const graph = (patch: Partial<GraphSummary>): GraphSummary => ({
  id: 'g1',
  key: 'demo.batch',
  name: 'Batch',
  kind: 'workflow',
  description: '',
  isSystem: false,
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
          graph({ id: 'g2', kind: 'node', isSystem: true, publishedVersion: null })
        ]
      })
    );
    assert.ok(html.includes('href="/workflows/g1"'));
    assert.ok(html.includes('href="/runs/new?graph=g1"'));
    assert.ok(!html.includes('/runs/new?graph=g2'));
    assert.ok(html.includes('System'));
    assert.ok(html.includes('v2'));
  });

  it('renders the page shell with a create action', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowsPage, {
        client: { list: async () => [] } as unknown as WorkflowsClient
      })
    );
    assert.ok(html.includes('<h1'));
    assert.ok(html.includes('New graph'));
  });
});
