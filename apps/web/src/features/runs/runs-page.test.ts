import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { RunSummary, RunsClient } from './client.ts';
import { RunsPage, RunsTable } from './runs-page.tsx';

const run: RunSummary = {
  id: 'r1',
  status: 'faulted',
  parent_id: null,
  parent_index: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  completed_at: null,
  graph_id: 'g1',
  key: 'demo.batch',
  name: 'Batch',
  version: 3,
  version_id: 'v3',
  error_message: 'payer rejected'
};

describe('RunsPage', () => {
  it('lists runs with status, version and problems', () => {
    const html = renderToStaticMarkup(createElement(RunsTable, { runs: [run] }));
    assert.ok(html.includes('href="/runs/r1"'));
    assert.ok(html.includes('v3'));
    assert.ok(html.includes('Stuck'));
    assert.ok(html.includes('payer rejected'));
  });

  it('renders a status filter', () => {
    const html = renderToStaticMarkup(
      createElement(RunsPage, {
        client: { list: async () => [] } as unknown as RunsClient,
        live: { subscribe: () => () => undefined, close: () => undefined },
        status: 'faulted'
      })
    );
    assert.ok(
      html.includes('aria-current="true" href="/runs?status=faulted"') ||
        html.includes('href="/runs?status=faulted" aria-current="true"')
    );
    assert.ok(html.includes('href="/runs"'));
  });
});
