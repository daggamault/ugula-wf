import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { idleLive } from '../../shared/testing.ts';
import { searchStateOf } from '../../shared/url-state.ts';
import type { TableSummary, WorkflowsClient } from './client.ts';
import {
  TABLES_TABLE,
  TablesPage,
  TablesTable,
  tableFilterOf,
  tableKindLabel
} from './tables-page.tsx';

const table = (patch: Partial<TableSummary>): TableSummary => ({
  id: 't1',
  key: 'billing.base-rate',
  name: 'Base Rate',
  kind: 'decide',
  description: '',
  scope: 'system',
  overrides: null,
  overriddenBy: null,
  isStale: false,
  publishedVersion: 1,
  draftVersion: null,
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...patch
});

describe('TablesPage', () => {
  it('lists tables with their kind, scope and an edit action', () => {
    const html = renderToStaticMarkup(
      createElement(TablesTable, {
        tables: [
          table({ overriddenBy: 't2' }),
          table({ id: 't2', scope: 'agency', kind: 'lookup', isStale: true, draftVersion: 2 })
        ],
        search: searchStateOf('/tables', new URLSearchParams('q=rate'), TABLES_TABLE)
      })
    );
    assert.ok(html.includes('Decision Table') && html.includes('Lookup Table'));
    assert.ok(html.includes('>Built-in<') && html.includes('>Agency<'));
    assert.ok(html.includes('Has Your Copy') && html.includes('Base Updated'));
    assert.ok(html.includes('href="/tables/t2" aria-label="Edit Base Rate"'));
    assert.match(html, /<mark[^>]*>Rate<\/mark>/);
  });

  it('filters customized tables', () => {
    assert.equal(tableFilterOf(new URLSearchParams('show=customized')), 'customized');
    assert.equal(tableFilterOf(new URLSearchParams('show=x')), 'all');
    assert.equal(tableKindLabel('lookup'), 'Lookup Table');
    const html = renderToStaticMarkup(
      createElement(TablesPage, {
        client: {
          tables: { search: () => new Promise(() => undefined) }
        } as unknown as WorkflowsClient,
        live: idleLive,
        show: 'customized'
      })
    );
    assert.ok(html.includes('<h1') && html.includes('Tables'));
    assert.match(
      html,
      /role="option"[^>]*aria-selected="true" data-value="customized"[^>]*><span[^>]*>Customized<\/span>/
    );
  });
});
