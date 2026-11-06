import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConfigEditor, TABLE_EDITORS, TableReference } from './node-settings.tsx';

describe('ConfigEditor', () => {
  it('shows node settings as formatted JSON, read-only when not editable', () => {
    const html = renderToStaticMarkup(
      createElement(ConfigEditor, {
        node: { id: 'n1', type: 'std.expr', version: 1, config: { expression: '1' } },
        editable: false,
        onConfig: () => undefined
      })
    );
    assert.ok(html.includes('Settings (JSON)') && html.includes('disabled=""'));
    assert.ok(html.includes('&quot;expression&quot;: &quot;1&quot;'));
  });
});

describe('TableReference', () => {
  it('links a shared table and says when it is customized or unavailable', () => {
    const custom = renderToStaticMarkup(
      createElement(TableReference, {
        tableKey: 'billing.classification',
        table: { id: 't1', key: 'billing.classification', name: 'Classification', scope: 'agency' }
      })
    );
    assert.ok(
      custom.includes('href="/tables/t1"') && custom.includes('Customized for This Agency')
    );
    const missing = renderToStaticMarkup(
      createElement(TableReference, { tableKey: 'x', table: undefined })
    );
    assert.ok(missing.includes('not available to your agency'));
  });

  it('edits lookup and decision tables inline', () => {
    assert.deepEqual(Object.keys(TABLE_EDITORS), ['std.table.lookup', 'std.table.decide']);
  });
});
