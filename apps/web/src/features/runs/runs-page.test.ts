import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { formatDateTime } from '../../shared/format.ts';
import { idleLive } from '../../shared/testing.ts';
import type { RunSummary, RunsClient } from './client.ts';
import { RunsPage, RunsTable, statusOptions } from './runs-page.tsx';

const run: RunSummary = {
  id: 'r1',
  status: 'faulted',
  parent_id: null,
  parent_index: null,
  parent_wait: null,
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
  it('lists runs with status, version, problems and an open action', () => {
    const html = renderToStaticMarkup(createElement(RunsTable, { runs: [run] }));
    assert.ok(html.includes('<span class="sr-only">Actions</span>'));
    assert.ok(
      html.includes(
        `href="/runs/r1" aria-label="Open run Batch started ${formatDateTime(run.created_at)}"`
      )
    );
    assert.equal(html.split('href="/runs/r1"').length, 2);
    assert.ok(html.includes('v3'));
    assert.ok(html.includes('Stuck'));
    assert.ok(html.includes('payer rejected'));
  });

  it('renders a status filter with one label per status', () => {
    const html = renderToStaticMarkup(
      createElement(RunsPage, {
        client: { list: async () => [] } as unknown as RunsClient,
        live: idleLive,
        status: 'faulted'
      })
    );
    assert.ok(html.includes('>Status<'));
    assert.match(html, /<option value="faulted" selected="">Stuck<\/option>/);
    assert.ok(html.includes('<option value="suspended">Waiting</option>'));
  });

  it('links each status option to its filter', () => {
    const options = statusOptions((name, value) => (value ? `/runs?${name}=${value}` : '/runs'));
    assert.deepEqual(options[0], { value: '', label: 'All Statuses', href: '/runs' });
    assert.ok(options.some((o) => o.href === '/runs?status=faulted' && o.label === 'Stuck'));
  });
});
