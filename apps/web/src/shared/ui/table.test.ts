import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Table, TableCell, TableRow } from './table.tsx';

describe('Table', () => {
  it('renders a labelled table with column headers and cells', () => {
    const html = renderToStaticMarkup(
      createElement(Table, {
        label: 'Runs',
        head: [
          'Name',
          { label: 'Total', isNumeric: true },
          { label: 'Actions', isLabelHidden: true }
        ],
        children: createElement(
          TableRow,
          null,
          createElement(TableCell, null, 'Batch'),
          createElement(TableCell, { kind: 'numeric' }, '$1.00')
        )
      })
    );
    assert.ok(html.includes('aria-label="Runs"'));
    assert.ok(html.includes('<th scope="col"'));
    assert.ok(html.includes('Batch</td>'));
    assert.ok(html.includes('text-right tabular-nums'));
    assert.ok(html.includes('<span class="sr-only">Actions</span>'));
  });
});
