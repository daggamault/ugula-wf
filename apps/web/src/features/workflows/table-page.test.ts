import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Json } from '@ugula/graph';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { idleLive } from '../../shared/testing.ts';
import type { GraphScope, TableComparison, TableDetail, WorkflowsClient } from './client.ts';
import { TablePage, TableView, tablePath } from './table-page.tsx';

const RATES: Json = {
  type: 'string',
  rows: [{ key: 'ALS1', value: 'A0427' }]
};

const detail = (scope: GraphScope, published: boolean, effectiveScope = scope): TableDetail => ({
  table: {
    id: 't1',
    scope,
    key: 'billing.codes',
    name: 'Codes',
    kind: 'lookup',
    description: '',
    overridden_by: null,
    overrides: scope === 'system' ? null : 't0',
    is_stale: false,
    canEdit: scope !== 'system',
    canOverride: { organization: scope === 'system', agency: scope === 'system' },
    effectiveId: effectiveScope === scope ? 't1' : 't9',
    effectiveScope
  },
  versions: [
    {
      id: 'v1',
      version: 1,
      published_at: published ? '2026-01-01' : null,
      created_at: '2026-01-01',
      base_version: null,
      base_table_id: null
    }
  ]
});

const render = (d: TableDetail, comparison: TableComparison | null = null, source = RATES) =>
  renderToStaticMarkup(
    createElement(TableView, {
      detail: d,
      version: 1,
      source,
      comparison,
      client: {} as WorkflowsClient,
      onSaved: () => undefined
    })
  );

describe('TableView', () => {
  it('offers built-in tables for overriding and opens the copy in effect', () => {
    const html = render(detail('system', true));
    assert.ok(
      html.includes('Override for Organization') && html.includes('Override for This Agency')
    );
    assert.ok(html.includes('>Built-in<') && html.includes('Built-in tables are read-only'));
    assert.ok(html.includes('value="A0427"') && html.includes('disabled'));
    const copied = render(detail('system', true, 'agency'));
    assert.ok(copied.includes('href="/tables/t9"') && copied.includes('Open Agency Copy'));
    assert.ok(copied.includes('Has Agency Copy') && !copied.includes('Override for This Agency'));
  });

  it('edits a draft copy, marks changes from its base and warns when the base moved', () => {
    const base: Json = { type: 'string', rows: [{ key: 'ALS1', value: 'A0426' }] };
    const html = render(detail('agency', false), {
      mine: { version: 1, definition: RATES },
      copiedFrom: { version: 1, definition: base, scope: 'system' },
      latest: { version: 2, definition: base },
      baseChanged: true
    });
    assert.ok(html.includes('Draft v1') && html.includes('>Save<') && html.includes('>Publish<'));
    assert.ok(html.includes('Changed From Base') && html.includes('Reset to Base'));
    assert.ok(html.includes('Base Updated.') && html.includes('Remove Override'));
    assert.ok(html.includes('border-custom/40'));
  });

  it('builds table paths and waits for the table', () => {
    assert.equal(tablePath('t1'), '/tables/t1');
    assert.equal(tablePath('t1', 2), '/tables/t1?version=2');
    const html = renderToStaticMarkup(
      createElement(TablePage, {
        client: {
          tables: {
            find: () => new Promise(() => undefined),
            compare: () => new Promise(() => undefined),
            version: () => new Promise(() => undefined)
          }
        } as unknown as WorkflowsClient,
        live: idleLive,
        tableId: 't1',
        version: null
      })
    );
    assert.ok(html.includes('aria-label="Loading"'));
  });
});
