import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Table, TableCell, TableRow } from './table.tsx';

const render = (sorting?: Parameters<typeof Table>[0]['sorting']) =>
  renderToStaticMarkup(
    createElement(Table, {
      label: 'Runs',
      head: [
        { label: 'Name', sort: 'name' },
        { label: 'Total', isNumeric: true, sort: 'total' },
        { label: 'Started', isSecondary: true },
        { label: 'Actions', isLabelHidden: true }
      ],
      ...(sorting ? { sorting } : {}),
      children: createElement(
        TableRow,
        null,
        createElement(TableCell, null, 'Batch'),
        createElement(TableCell, { kind: 'numeric' }, '$1.00'),
        createElement(TableCell, { isSecondary: true }, 'Today'),
        null,
        createElement(TableCell, { kind: 'actions' }, 'Open')
      )
    })
  );

describe('Table', () => {
  it('is a labelled table on wider screens and labelled cards on phones', () => {
    const html = render();
    assert.ok(html.includes('aria-label="Runs"'));
    assert.ok(html.includes('<th scope="col"'));
    assert.ok(html.includes('sr-only md:not-sr-only'));
    assert.ok(html.includes('md:table-row'));
    assert.ok(!html.includes('md:hidden">Name<'));
    assert.ok(html.includes('md:hidden">Total</span>'));
    assert.ok(html.includes('md:hidden">Started</span>'));
    assert.ok(!html.includes('md:hidden">Actions<'));
    assert.ok(html.includes('<span class="sr-only">Actions</span>'));
    assert.ok(html.includes('md:hidden lg:table-cell'));
    assert.ok(!html.includes('href='));
  });

  it('turns sortable headers into links that show the current order', () => {
    const html = render({
      sort: 'total',
      dir: 'desc',
      sortHref: (k) => `/runs?sort=${k}`,
      sortTo: (k, d) => `/runs?sort=${k}&dir=${d}`
    });
    assert.ok(html.includes('aria-sort="descending"'));
    assert.ok(html.includes('href="/runs?sort=name"') && html.includes('href="/runs?sort=total"'));
    assert.equal(html.match(/aria-sort=/g)?.length, 1);
    assert.ok(html.includes('Sort By'));
    assert.ok(html.includes('<option value="total:desc" selected="">Total, Descending</option>'));
    assert.ok(!html.includes('Default Order'));
    const unlisted = render({
      sort: 'created',
      dir: 'desc',
      sortHref: (k) => `/runs?sort=${k}`,
      sortTo: (k, d) => `/runs?sort=${k}&dir=${d}`
    });
    assert.ok(unlisted.includes('<option value="created:desc" selected="">Default Order</option>'));
    assert.ok(!unlisted.includes('aria-sort='));
  });
});

describe('Table alignment', () => {
  it('left-aligns every column, numbers included, with the sort arrow after the label', () => {
    const html = render({
      sort: 'total',
      dir: 'asc',
      sortHref: (k) => `/runs?sort=${k}`,
      sortTo: (k, d) => `/runs?sort=${k}&dir=${d}`
    });
    assert.doesNotMatch(html, /(?<![\w:-])(md:)?text-right/);
    assert.ok(!html.includes('flex-row-reverse'));
    assert.ok(html.includes('tabular-nums'));
  });
});
