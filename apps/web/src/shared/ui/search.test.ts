import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { render, screen, userEvent } from '../testing-dom.ts';
import { type Page, searchStateOf } from '../url-state.ts';
import type { Resource } from '../use-resource.ts';
import { Search } from './search.tsx';

type Row = { id: string };

const spec = { sorts: { name: 'asc' }, sort: 'name' } as const;

const resource = (over: Partial<Resource<Page<Row>>>): Resource<Page<Row>> => ({
  data: undefined,
  error: undefined,
  loading: false,
  reload: () => undefined,
  ...over
});

const loaded = (items: Row[], total = items.length) =>
  resource({ data: { items, total, page: 1, pageSize: 25 } });

const show = (
  query: string,
  results: Resource<Page<Row>>,
  extra: { isFiltered?: boolean; filters?: ReturnType<typeof createElement> } = {}
) => {
  window.history.replaceState(null, '', `/imports${query ? `?${query}` : ''}`);
  const shown: (readonly Row[])[] = [];
  render(
    createElement(Search<Row>, {
      label: 'Imports',
      path: '/imports',
      search: searchStateOf('/imports', new URLSearchParams(query), spec),
      results,
      empty: {
        title: 'No Imports Yet',
        children: 'Drop a file.',
        action: createElement('button', { type: 'button' }, 'Upload')
      },
      children: (items) => {
        shown.push(items);
        return createElement('p', null, `${items.length} rows`);
      },
      ...extra
    })
  );
  return shown;
};

const emptyTitle = () => screen.getByRole('heading', { level: 2 }).textContent;

describe('Search', () => {
  it('offers a named search box for the list', () => {
    show('', loaded([]));
    const box = screen.getByRole('searchbox', { name: 'Search' });
    assert.equal(box.getAttribute('placeholder'), 'Search imports');
    assert.equal(box.closest('search')?.getAttribute('aria-label'), 'Search Imports');
  });

  it('searches on the server by putting the words in the address', async () => {
    show('sort=name', loaded([]));
    const user = userEvent.setup();
    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'oct{Enter}');
    assert.equal(
      `${window.location.pathname}${window.location.search}`,
      '/imports?sort=name&q=oct'
    );
  });

  it('shows extra filters beside the search box', () => {
    show('', loaded([]), { filters: createElement('button', { type: 'button' }, 'Status') });
    assert.equal(screen.getByRole('button', { name: 'Status' }).tagName, 'BUTTON');
  });

  it('renders the results with pagination', () => {
    const shown = show('', loaded([{ id: 'a' }], 30));
    assert.deepEqual(shown.at(-1), [{ id: 'a' }]);
    assert.equal(screen.getByText('1 rows').tagName, 'P');
    assert.equal(
      screen.getByRole('navigation', { name: 'Imports pages' }).querySelector('[aria-live]')
        ?.textContent,
      '1–25 of 30 · Page 1 of 2'
    );
  });

  it('keeps showing the last results while a reload is under way', () => {
    show('', resource({ ...loaded([{ id: 'a' }]), loading: true }));
    assert.equal(screen.getByText('1 rows').tagName, 'P');
    assert.ok(!screen.queryByRole('status', { name: 'Loading' }));
  });

  it('waits with a spinner before anything has loaded', () => {
    const shown = show('', resource({ loading: true }));
    assert.equal(screen.getByRole('status', { name: 'Loading' }).tagName, 'SPAN');
    assert.ok(!screen.queryByRole('heading'));
    assert.deepEqual(shown, []);
  });

  it('shows a load failure as an alert instead of the results', () => {
    const shown = show(
      '',
      resource({ ...loaded([{ id: 'a' }]), error: new Error('Server unavailable') })
    );
    assert.equal(screen.getByRole('alert').textContent, 'Server unavailable');
    assert.deepEqual(shown, []);
  });

  it('explains an empty list with its own words and action', () => {
    show('', loaded([]));
    assert.equal(emptyTitle(), 'No Imports Yet');
    assert.equal(screen.getByText('Drop a file.').tagName, 'P');
    assert.equal(screen.getByRole('button', { name: 'Upload' }).tagName, 'BUTTON');
  });

  it('explains a search without matches', () => {
    show('q=oct', loaded([]));
    assert.equal(emptyTitle(), 'No Matching Imports');
    assert.equal(
      screen.getByText(/^Nothing matches/).textContent,
      'Nothing matches “oct”. Try fewer letters or another word.'
    );
  });

  it('explains filters without matches', () => {
    show('', loaded([]), { isFiltered: true });
    assert.equal(emptyTitle(), 'No Matching Imports');
    assert.equal(
      screen.getByText(/^Nothing matches/).textContent,
      'Nothing matches these filters.'
    );
  });

  it('offers a way back from a page past the end', () => {
    show('page=3&q=oct', loaded([]));
    assert.equal(emptyTitle(), 'Past the Last Page');
    assert.equal(
      screen.getByText(/^There are no more/).textContent,
      'There are no more imports after this page.'
    );
    assert.equal(
      screen.getByRole('link', { name: 'Go to First Page' }).getAttribute('href'),
      '/imports?q=oct'
    );
  });
});
