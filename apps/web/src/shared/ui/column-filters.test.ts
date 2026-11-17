import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { render, screen, userEvent, within } from '../testing-dom.ts';
import { type Facets, searchStateOf } from '../url-state.ts';
import { type ColumnFilter, ColumnFilters, choicesOf, toggled } from './column-filters.tsx';

const STATUS: ColumnFilter = {
  key: 'status',
  label: 'Status',
  labelOf: (o) => o.value.toUpperCase()
};

const QUEUE: ColumnFilter = { key: 'queue', label: 'Queue' };

const spec = { sorts: { name: 'asc' }, sort: 'name', filters: ['status', 'queue'] } as const;

const show = (query: string, facets: Facets | undefined) => {
  window.history.replaceState(null, '', `/runs${query ? `?${query}` : ''}`);
  render(
    createElement(ColumnFilters, {
      filters: [STATUS, QUEUE],
      facets,
      search: searchStateOf('/runs', new URLSearchParams(query), spec)
    })
  );
  return userEvent.setup();
};

const optionsIn = (name: string) =>
  within(screen.getByRole('dialog', { name }))
    .getAllByRole('checkbox')
    .map((c) => [c.closest('label')?.textContent, (c as HTMLInputElement).checked]);

describe('choicesOf', () => {
  it('labels each value, keeps chosen values the database no longer has, and sorts by label', () => {
    assert.deepEqual(
      choicesOf(
        STATUS,
        [
          { value: 'paid', count: 3 },
          { value: 'denied', count: 9 }
        ],
        ['open']
      ),
      [
        { value: 'denied', label: 'DENIED', count: 9 },
        { value: 'open', label: 'OPEN', count: 0 },
        { value: 'paid', label: 'PAID', count: 3 }
      ]
    );
  });

  it('falls back to the label from the database, then the value', () => {
    assert.deepEqual(
      choicesOf(
        QUEUE,
        [
          { value: 'u1', label: 'Ann', count: 1 },
          { value: 'x', count: 2 }
        ],
        []
      ),
      [
        { value: 'u1', label: 'Ann', count: 1 },
        { value: 'x', label: 'x', count: 2 }
      ]
    );
  });
});

describe('toggled', () => {
  it('adds a value that is not chosen and removes one that is', () => {
    assert.deepEqual(toggled(['a'], 'b'), ['a', 'b']);
    assert.deepEqual(toggled(['a', 'b'], 'a'), ['b']);
  });
});

describe('ColumnFilters', () => {
  it('shows one button per column and how many values each has chosen', () => {
    show('status=paid,denied', undefined);
    assert.equal(
      screen.getByRole('button', { name: 'Status 2 selected' }).getAttribute('aria-haspopup'),
      'dialog'
    );
    assert.equal(screen.getByRole('button', { name: 'Queue' }).textContent, 'Queue');
  });

  it('lists values with counts and goes to the list with a value added or removed', async () => {
    const user = show('status=paid&page=2', {
      status: [
        { value: 'paid', count: 3 },
        { value: 'denied', count: 9 }
      ]
    });
    await user.click(screen.getByRole('button', { name: /^Status/ }));
    assert.deepEqual(optionsIn('Filter by Status'), [
      ['DENIED9', false],
      ['PAID3', true]
    ]);
    await user.click(screen.getByRole('checkbox', { name: /DENIED/ }));
    assert.equal(window.location.search, '?status=paid%2Cdenied');
  });

  it('clears one column at a time', async () => {
    const user = show('status=paid&queue=q1', { status: [{ value: 'paid', count: 3 }] });
    await user.click(screen.getByRole('button', { name: /^Status/ }));
    await user.click(screen.getByRole('button', { name: 'Clear Status' }));
    assert.equal(window.location.search, '?queue=q1');
  });

  it('says when there is nothing to filter by', async () => {
    const user = show('', { queue: [] });
    await user.click(screen.getByRole('button', { name: 'Queue' }));
    assert.equal(
      within(screen.getByRole('dialog', { name: 'Filter by Queue' })).getByText(/^Nothing/)
        .textContent,
      'Nothing to filter yet.'
    );
  });

  it('finds values in a long list', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ value: `q${i}`, count: i }));
    const user = show('', { queue: many });
    await user.click(screen.getByRole('button', { name: 'Queue' }));
    await user.type(screen.getByRole('searchbox', { name: 'Find Queue' }), 'q1');
    assert.deepEqual(
      optionsIn('Filter by Queue').map(([label]) => label),
      ['q11', 'q1010', 'q1111']
    );
    await user.clear(screen.getByRole('searchbox', { name: 'Find Queue' }));
    await user.type(screen.getByRole('searchbox', { name: 'Find Queue' }), 'zz');
    assert.equal(screen.getByText(/^No queue/).textContent, 'No queue matches.');
  });
});
