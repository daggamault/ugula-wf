import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { searchStateOf } from '../url-state.ts';
import type { Resource } from '../use-resource.ts';
import { Search } from './search.tsx';

type Row = { id: string };

const spec = { sorts: { name: 'asc' }, sort: 'name' } as const;

const results = (
  items: Row[],
  loading = false
): Resource<{
  items: Row[];
  total: number;
  page: number;
  pageSize: number;
}> => ({
  data: loading ? undefined : { items, total: items.length, page: 1, pageSize: 25 },
  error: undefined,
  loading,
  reload: () => undefined
});

const render = (query: string, rows: Row[], extra: { isFiltered?: boolean } = {}) =>
  renderToStaticMarkup(
    createElement(Search<Row>, {
      label: 'Imports',
      path: '/imports',
      search: searchStateOf('/imports', new URLSearchParams(query), spec),
      results: results(rows),
      empty: { title: 'No Imports Yet', children: 'Drop a file.' },
      children: (items) => createElement('p', null, `${items.length} rows`),
      ...extra
    })
  );

describe('Search', () => {
  it('searches on the server and renders the results with pagination', () => {
    const html = render('', [{ id: 'a' }]);
    assert.ok(html.includes('aria-label="Search Imports"'));
    assert.ok(html.includes('placeholder="Search imports"') && html.includes('sr-only">Search<'));
    assert.ok(html.includes('<p>1 rows</p>'));
  });

  it('explains an empty list, a search without matches, filters and a page past the end', () => {
    assert.ok(render('', []).includes('No Imports Yet') && render('', []).includes('Drop a file.'));
    assert.ok(render('q=oct', []).includes('Nothing matches “oct”.'));
    assert.ok(render('', [], { isFiltered: true }).includes('Nothing matches these filters.'));
    assert.ok(render('page=3', []).includes('Past the Last Page'));
  });
});
