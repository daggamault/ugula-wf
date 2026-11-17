import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { render, screen, userEvent, within } from '../testing-dom.ts';
import { Table, TableCell, TableRow, type TableSorting } from './table.tsx';

const sortingOf = (sort: string, dir: 'asc' | 'desc'): TableSorting => ({
  sort,
  dir,
  sortHref: (k) => `/runs?sort=${k}`,
  sortTo: (k, d) => `/runs?sort=${k}&dir=${d}`
});

const show = (sorting?: TableSorting) =>
  render(
    createElement(Table, {
      label: 'Runs',
      head: [
        { label: 'Name', sort: 'name' },
        { label: 'Total', sort: 'total' },
        { label: 'Started', isSecondary: true },
        { label: 'Hidden', isLabelHidden: true },
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
        createElement(TableCell, null, 'Secret'),
        createElement(TableCell, { kind: 'actions' }, 'Open')
      )
    })
  );

const table = () => screen.getByRole('table', { name: 'Runs' });
const header = (name: string) => within(table()).getByRole('columnheader', { name });
const cells = () => within(table()).getAllByRole('cell');
const here = () => `${window.location.pathname}${window.location.search}`;

describe('Table', () => {
  it('is a labelled table with a column header per column', () => {
    show();
    assert.deepEqual(
      within(table())
        .getAllByRole('columnheader')
        .map((th) => [th.textContent, th.getAttribute('scope')]),
      [
        ['Name', 'col'],
        ['Total', 'col'],
        ['Started', 'col'],
        ['Hidden', 'col'],
        ['Actions', 'col']
      ]
    );
  });

  it('keeps a hidden column label for screen readers', () => {
    show();
    assert.equal(
      within(header('Actions')).getByText('Actions').classList.contains('sr-only'),
      true
    );
    assert.equal(within(header('Name')).getByText('Name').classList.contains('sr-only'), false);
  });

  it('labels each value with its column for phones, except the title and actions', () => {
    show();
    assert.deepEqual(
      cells().map((td) => [...td.children].map((c) => c.textContent)),
      [['Batch'], ['Total', '$1.00'], ['Started', 'Today'], ['Secret'], ['Open']]
    );
  });

  it('places cells by position, skipping empty children', () => {
    show();
    assert.equal(cells().length, 5);
    assert.ok(!within(cells()[3] as HTMLElement).queryByText('Hidden'));
  });

  it('hides secondary columns on mid-size screens only', () => {
    show();
    assert.equal(header('Started').classList.contains('@4xl:hidden'), true);
    assert.equal(header('Started').classList.contains('@6xl:table-cell'), true);
    assert.equal(cells()[2]?.classList.contains('@4xl:hidden'), true);
    assert.equal(header('Total').classList.contains('@4xl:hidden'), false);
  });

  it('shows plain headers without sorting', () => {
    show();
    assert.equal(within(table()).queryAllByRole('link').length, 0);
    assert.equal(
      within(table())
        .getAllByRole('columnheader')
        .some((th) => th.hasAttribute('aria-sort')),
      false
    );
    assert.ok(!screen.queryByRole('button', { name: 'Sort By' }));
  });

  it('marks a compact column to shrink to its content', () => {
    render(
      createElement(Table, {
        label: 'Claims',
        head: ['Patient', { label: 'Due', isCompact: true }],
        children: createElement(TableRow, null, createElement(TableCell, null, 'Doe, Jane'))
      })
    );
    assert.equal(
      screen.getByRole('columnheader', { name: 'Due' }).classList.contains('w-px'),
      true
    );
    assert.equal(
      screen.getByRole('columnheader', { name: 'Patient' }).classList.contains('w-px'),
      false
    );
  });

  it('passes extra attributes through to the cell', () => {
    render(
      createElement(Table, {
        label: 'Claims',
        head: ['Patient'],
        children: createElement(TableRow, null, createElement(TableCell, { colSpan: 3 }, 'All'))
      })
    );
    assert.equal(screen.getByRole('cell').getAttribute('colspan'), '3');
  });
});

describe('Table sorting', () => {
  it('turns sortable headers into links and marks only the sorted column', () => {
    show(sortingOf('total', 'desc'));
    assert.equal(
      within(header('Name')).getByRole('link', { name: 'Name' }).getAttribute('href'),
      '/runs?sort=name'
    );
    assert.equal(
      within(header('Total')).getByRole('link', { name: 'Total' }).getAttribute('href'),
      '/runs?sort=total'
    );
    assert.ok(!within(header('Started')).queryByRole('link'));
    assert.deepEqual(
      within(table())
        .getAllByRole('columnheader')
        .map((th) => th.getAttribute('aria-sort')),
      [null, 'descending', null, null, null]
    );
  });

  it('says ascending for an ascending sort', () => {
    show(sortingOf('name', 'asc'));
    assert.equal(header('Name').getAttribute('aria-sort'), 'ascending');
  });

  it('marks no column when sorted by something not shown', () => {
    show(sortingOf('created', 'desc'));
    assert.equal(
      within(table())
        .getAllByRole('columnheader')
        .some((th) => th.hasAttribute('aria-sort')),
      false
    );
  });

  it('sorts in place when a header link is followed', async () => {
    show(sortingOf('total', 'desc'));
    await userEvent.setup().click(within(header('Name')).getByRole('link'));
    assert.equal(here(), '/runs?sort=name');
  });
});

describe('Table sorting on phones', () => {
  it('offers each sortable column in both directions with the current order chosen', () => {
    show(sortingOf('total', 'desc'));
    assert.equal(screen.getByRole('button', { name: 'Sort By' }).textContent, 'Total, Descending');
    const list = screen.getByRole('listbox');
    assert.deepEqual(
      within(list)
        .getAllByRole('option')
        .map((o) => [o.textContent, o.getAttribute('aria-selected')]),
      [
        ['Name, Ascending', 'false'],
        ['Name, Descending', 'false'],
        ['Total, Ascending', 'false'],
        ['Total, Descending', 'true']
      ]
    );
  });

  it('adds a Default Order choice when the current sort is not a column', () => {
    show(sortingOf('created', 'desc'));
    assert.equal(screen.getByRole('button', { name: 'Sort By' }).textContent, 'Default Order');
    assert.deepEqual(
      screen.getAllByRole('option').map((o) => o.textContent),
      [
        'Default Order',
        'Name, Ascending',
        'Name, Descending',
        'Total, Ascending',
        'Total, Descending'
      ]
    );
  });

  it('navigates to the chosen order', async () => {
    show(sortingOf('total', 'desc'));
    await userEvent.setup().click(screen.getByRole('option', { name: 'Name, Ascending' }));
    assert.equal(here(), '/runs?sort=name&dir=asc');
  });

  it('offers no sort menu when no column sorts', () => {
    render(
      createElement(Table, {
        label: 'Fees',
        head: ['Code', 'Amount'],
        sorting: sortingOf('created', 'desc'),
        children: createElement(TableRow, null, createElement(TableCell, null, 'A0427'))
      })
    );
    assert.ok(!screen.queryByRole('button', { name: 'Sort By' }));
    assert.ok(!screen.queryByRole('link'));
  });
});
