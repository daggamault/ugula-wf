import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { type Page, searchStateOf } from '../url-state.ts';
import type { Resource } from '../use-resource.ts';
import { Search } from './search.tsx';

type Row = { id: string };

const spec = { sorts: { name: 'asc' }, sort: 'name' } as const;

const loaded = (items: Row[]): Resource<Page<Row>> => ({
  data: { items, total: items.length, page: 1, pageSize: 25 },
  error: undefined,
  loading: false,
  reload: () => undefined
});

const render = (
  query: string,
  results: Resource<Page<Row>>,
  extra: { isFiltered?: boolean } = {}
) =>
  renderToStaticMarkup(
    createElement(Search<Row>, {
      label: 'Imports',
      path: '/imports',
      search: searchStateOf('/imports', new URLSearchParams(query), spec),
      results,
      empty: { title: 'No Imports Yet', children: 'Drop a file.' },
      children: (items) => createElement('p', null, `${items.length} rows`),
      ...extra
    })
  );

describe('Search', () => {
  it('searches on the server and renders the results with pagination', () => {
    const html = render('', loaded([{ id: 'a' }]));
    assert.ok(html.includes('aria-label="Search Imports"'));
    assert.ok(html.includes('placeholder="Search imports"') && html.includes('sr-only">Search<'));
    assert.ok(html.includes('<p>1 rows</p>') && html.includes('1–1 of 1'));
  });

  it('explains an empty list, a search without matches, filters and a page past the end', () => {
    const none = loaded([]);
    assert.ok(
      render('', none).includes('No Imports Yet') && render('', none).includes('Drop a file.')
    );
    assert.ok(render('q=oct', none).includes('Nothing matches “oct”.'));
    assert.ok(render('q=oct', none).includes('No Matching Imports'));
    assert.ok(render('', none, { isFiltered: true }).includes('Nothing matches these filters.'));
    const past = render('page=3', none);
    assert.ok(past.includes('Past the Last Page') && past.includes('href="/imports"'));
    assert.ok(past.includes('There are no more imports after this page.'));
  });

  it('shows a load failure as an alert and waits with a spinner', () => {
    const failed = render('', {
      data: undefined,
      error: new Error('Server unavailable'),
      loading: false,
      reload: () => undefined
    });
    assert.ok(failed.includes('role="alert"') && failed.includes('Server unavailable'));
    const loading = render('', {
      data: undefined,
      error: undefined,
      loading: true,
      reload: () => undefined
    });
    assert.ok(loading.includes('aria-label="Loading"') && !loading.includes('No Imports Yet'));
  });
});
