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
        { label: 'Total', sort: 'total' },
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
    assert.ok(html.includes('sr-only @4xl:not-sr-only'));
    assert.ok(html.includes('@4xl:table-row'));
    assert.ok(!html.includes('@4xl:hidden">Name<'));
    assert.ok(html.includes('@4xl:hidden">Total</span>'));
    assert.ok(html.includes('@4xl:hidden">Started</span>'));
    assert.ok(!html.includes('@4xl:hidden">Actions<'));
    assert.ok(html.includes('<span class="sr-only">Actions</span>'));
    assert.ok(html.includes('@4xl:hidden @6xl:table-cell'));
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
    assert.match(
      html,
      /role="option"[^>]*aria-selected="true" data-value="total:desc"[^>]*><span[^>]*>Total, Descending<\/span>/
    );
    assert.ok(!html.includes('Default Order'));
    const unlisted = render({
      sort: 'created',
      dir: 'desc',
      sortHref: (k) => `/runs?sort=${k}`,
      sortTo: (k, d) => `/runs?sort=${k}&dir=${d}`
    });
    assert.match(
      unlisted,
      /role="option"[^>]*aria-selected="true" data-value="created:desc"[^>]*><span[^>]*>Default Order<\/span>/
    );
    assert.ok(!unlisted.includes('aria-sort='));
  });
});

describe('Table sorting on phones', () => {
  it('offers no sort menu when no column sorts', () => {
    const html = renderToStaticMarkup(
      createElement(Table, {
        label: 'Fees',
        head: ['Code', 'Amount'],
        sorting: {
          sort: 'created',
          dir: 'desc',
          sortHref: (k) => `/fees?sort=${k}`,
          sortTo: (k, d) => `/fees?sort=${k}&dir=${d}`
        },
        children: createElement(TableRow, null, createElement(TableCell, null, 'A0427'))
      })
    );
    assert.ok(!html.includes('Sort By') && !html.includes('aria-haspopup="listbox"'));
    assert.ok(!html.includes('href='));
  });
});

describe('Table cells', () => {
  it('marks compact and muted cells and right-aligns phone values beside their label', () => {
    const html = renderToStaticMarkup(
      createElement(Table, {
        label: 'Claims',
        head: ['Patient', { label: 'Due', isCompact: true }],
        children: createElement(
          TableRow,
          null,
          createElement(TableCell, null, 'Doe, Jane'),
          createElement(TableCell, { kind: 'date', isMuted: true }, 'Today')
        )
      })
    );
    assert.ok(html.includes('w-px'));
    assert.ok(html.includes('justify-between text-surface-fg-muted tabular-nums'));
    assert.ok(html.includes('@max-4xl:text-right'));
    assert.ok(html.includes('@4xl:px-4 @4xl:py-3 @4xl:align-middle'));
    assert.ok(html.includes('rounded-xl') && !html.includes('shadow'));
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
    assert.doesNotMatch(html, /(?<![\w:-])(@4xl:)?text-right/);
    assert.ok(!html.includes('flex-row-reverse'));
    assert.ok(html.includes('tabular-nums'));
  });
});
