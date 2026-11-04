import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { idleLive } from '../../shared/testing.ts';
import { searchStateOf } from '../../shared/url-state.ts';
import type { GraphSummary, WorkflowsClient } from './client.ts';
import {
  GRAPH_TABLE,
  graphFilterOf,
  graphsQueryOf,
  WorkflowsPage,
  WorkflowsTable
} from './workflows-page.tsx';

const graph = (patch: Partial<GraphSummary>): GraphSummary => ({
  id: 'g1',
  key: 'demo.batch',
  name: 'Batch',
  kind: 'workflow',
  role: 'workflow',
  description: '',
  scope: 'agency',
  isSystem: false,
  overrides: null,
  isStale: false,
  overriddenBy: null,
  publishedVersion: 2,
  draftVersion: null,
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...patch
});

const search = (query = '') => searchStateOf('/workflows', new URLSearchParams(query), GRAPH_TABLE);

describe('WorkflowsPage', () => {
  it('lists graphs with kind, versions, highlighted matches and row actions', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowsTable, {
        graphs: [
          graph({}),
          graph({
            id: 'g2',
            kind: 'node',
            role: 'slot',
            scope: 'system',
            isSystem: true,
            publishedVersion: null
          }),
          graph({ id: 'g3', kind: 'node', scope: 'system', isSystem: true, overriddenBy: 'g4' }),
          graph({ id: 'g4', kind: 'node', overrides: 'g3', isStale: true })
        ],
        search: search('q=bat')
      })
    );
    assert.ok(html.includes('>Has Your Copy<') && html.includes('>Agency<'));
    assert.ok(html.includes('>Built-in<') && html.includes('>Agency Rule<'));
    assert.ok(html.includes('>Base Updated<') && html.includes('>Scope<'));
    assert.ok(html.includes('<span class="sr-only">Actions</span>'));
    assert.ok(html.includes('href="/workflows/g1" aria-label="Edit Batch"'));
    assert.equal(html.split('href="/workflows/g1"').length, 2);
    assert.ok(html.includes('href="/runs/new?graph=g1" aria-label="Run Batch"'));
    assert.ok(html.includes('>Run</span>') && html.includes('>Edit</span>'));
    assert.ok(!html.includes('/runs/new?graph=g2'));
    assert.ok(html.includes('Subworkflow'));
    assert.match(html, /<mark[^>]*>Bat<\/mark>ch/);
    assert.ok(html.includes('v2'));
  });

  it('renders a create link, a kind filter and the standard search', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowsPage, {
        live: idleLive,
        client: { search: () => new Promise(() => undefined) } as unknown as WorkflowsClient,
        show: 'blocks'
      })
    );
    assert.ok(html.includes('<h1'));
    assert.ok(html.includes('href="/workflows/new?kind=node"') && html.includes('New Subworkflow'));
    assert.ok(html.includes('<option value="blocks" selected="">Subworkflows</option>'));
    assert.ok(html.includes('aria-label="Search Subworkflows"') && html.includes('id="search-q"'));
    assert.ok(html.includes('href="/workflows/customized"') && html.includes('Customization Map'));
    assert.ok(html.includes('<option value="customized">Customized</option>'));
  });

  it('defaults to workflows, reads the kind param and asks the API for that kind', () => {
    assert.equal(graphFilterOf(new URLSearchParams()), 'workflows');
    assert.equal(graphFilterOf(new URLSearchParams('kind=blocks')), 'blocks');
    assert.equal(graphFilterOf(new URLSearchParams('kind=nope')), 'workflows');
    assert.equal(graphFilterOf(new URLSearchParams('kind=customized')), 'customized');
    assert.equal(
      graphsQueryOf(search('q=bat').apiQuery, 'mine'),
      'q=bat&page=1&pageSize=25&sort=name&dir=asc&show=mine'
    );
  });
});
