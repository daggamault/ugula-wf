import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { navigate } from './router.tsx';
import { act, render, screen } from './testing-dom.ts';
import {
  backLabelOf,
  backOf,
  hrefWith,
  searchStateOf,
  tableStateOf,
  useSearchState,
  useTableState,
  withBack
} from './url-state.ts';

const spec = { sorts: { created: 'desc', name: 'asc' }, sort: 'created' } as const;

const state = (search: string, prefix?: string) =>
  tableStateOf('/claims', new URLSearchParams(search), prefix ? { ...spec, prefix } : spec);

const sortOf = (search: string, prefix?: string) => {
  const s = state(search, prefix);
  return [s.sort, s.dir, s.page, s.pageSize];
};

describe('hrefWith', () => {
  it('sets and removes params while keeping the rest', () => {
    const q = new URLSearchParams('status=paid&page=2');
    assert.equal(
      hrefWith('/claims', q, { page: null, sort: 'name' }),
      '/claims?status=paid&sort=name'
    );
  });

  it('gives the bare path when no params are left', () => {
    assert.equal(hrefWith('/claims', new URLSearchParams(), {}), '/claims');
    assert.equal(hrefWith('/claims', new URLSearchParams('page=2'), { page: null }), '/claims');
  });

  it('does not change the query it is given', () => {
    const q = new URLSearchParams('page=2');
    hrefWith('/claims', q, { page: '3' });
    assert.equal(q.toString(), 'page=2');
  });
});

describe('tableStateOf', () => {
  it('reads sort, direction, page and size from the URL', () => {
    assert.deepEqual(sortOf('sort=name&dir=desc&page=3&pageSize=50'), ['name', 'desc', 3, 50]);
  });

  it('falls back to the default sort, direction, first page and size for bad values', () => {
    assert.deepEqual(sortOf('sort=evil&dir=sideways&page=-1&pageSize=7'), [
      'created',
      'desc',
      1,
      25
    ]);
    assert.deepEqual(sortOf('page=1.5&pageSize=abc'), ['created', 'desc', 1, 25]);
    assert.deepEqual(sortOf('sort=toString'), ['created', 'desc', 1, 25]);
  });

  it('uses the direction each sort starts in when none is given', () => {
    assert.equal(state('sort=name').dir, 'asc');
    assert.equal(state('').dir, 'desc');
  });

  it('builds the API query from the resolved state', () => {
    assert.equal(
      state('sort=name&dir=desc&page=3&pageSize=50&status=paid').apiQuery,
      'page=3&pageSize=50&sort=name&dir=desc'
    );
    assert.equal(state('').apiQuery, 'page=1&pageSize=25&sort=created&dir=desc');
  });

  it('links to the current page as it is', () => {
    assert.equal(state('status=paid&page=2').href, '/claims?status=paid&page=2');
    assert.equal(state('').href, '/claims');
  });

  it('links another header to its starting direction and resets the page', () => {
    const s = state('status=paid&page=3');
    assert.equal(s.sortHref('name'), '/claims?status=paid&sort=name&dir=asc');
  });

  it('flips the direction of the current sort', () => {
    assert.equal(
      state('status=paid').sortHref('created'),
      '/claims?status=paid&sort=created&dir=asc'
    );
    assert.equal(state('sort=name&dir=asc').sortHref('name'), '/claims?sort=name&dir=desc');
  });

  it('leaves the default sort and direction out of the URL', () => {
    assert.equal(state('sort=created&dir=asc').sortHref('created'), '/claims');
    assert.equal(state('sort=name').sortTo('created', 'desc'), '/claims');
  });

  it('links to a chosen sort and direction', () => {
    assert.equal(state('').sortTo('name', 'desc'), '/claims?sort=name&dir=desc');
    assert.equal(state('page=4').sortTo('created', 'asc'), '/claims?sort=created&dir=asc');
  });

  it('links pages, leaving the first page out of the URL', () => {
    const s = state('status=paid&page=2');
    assert.equal(s.pageHref(3), '/claims?status=paid&page=3');
    assert.equal(s.pageHref(1), '/claims?status=paid');
  });

  it('links sizes back to the first page, leaving the default size out of the URL', () => {
    const s = state('status=paid&page=2&pageSize=50');
    assert.equal(s.sizeHref(100), '/claims?status=paid&pageSize=100');
    assert.equal(s.sizeHref(25), '/claims?status=paid');
  });

  it('keeps several tables on one page apart with a prefix', () => {
    const s = state('mineSort=name&minePage=2&page=4&sort=created', 'mine');
    assert.deepEqual([s.sort, s.dir, s.page], ['name', 'asc', 2]);
    assert.equal(s.pageHref(3), '/claims?mineSort=name&minePage=3&page=4&sort=created');
    assert.equal(s.sizeHref(50), '/claims?mineSort=name&page=4&sort=created&minePageSize=50');
    assert.equal(s.sortHref('name'), '/claims?mineSort=name&page=4&sort=created&mineDir=desc');
  });
});

describe('table filters', () => {
  const filtered = { ...spec, filters: ['status', 'payer'] } as const;
  const of = (search: string, prefix?: string) =>
    tableStateOf(
      '/claims',
      new URLSearchParams(search),
      prefix ? { ...filtered, prefix } : filtered
    );

  it('reads each filter as a list of distinct values', () => {
    const s = of('status=paid,denied,paid,&payer=p1&other=x');
    assert.deepEqual(s.filters, { status: ['paid', 'denied'], payer: ['p1'] });
    assert.equal(s.isFiltered, true);
    assert.deepEqual(of('status=').filters, { status: [], payer: [] });
    assert.equal(of('').isFiltered, false);
    assert.deepEqual(state('status=paid').filters, {});
  });

  it('sends only the chosen filters to the API', () => {
    assert.equal(
      of('status=paid,denied&page=2').apiQuery,
      'page=2&pageSize=25&sort=created&dir=desc&status=paid%2Cdenied'
    );
    assert.equal(of('payer=').apiQuery, 'page=1&pageSize=25&sort=created&dir=desc');
  });

  it('links a changed filter back to the first page and leaves an empty one out', () => {
    const s = of('status=paid&page=3&sort=name');
    assert.equal(
      s.filterHref('status', ['paid', 'denied']),
      '/claims?status=paid%2Cdenied&sort=name'
    );
    assert.equal(s.filterHref('status', []), '/claims?sort=name');
    assert.equal(s.clearFiltersHref, '/claims?sort=name');
  });

  it('keeps filters of tables with a prefix apart', () => {
    const s = of('mineStatus=paid&status=denied&minePage=2', 'mine');
    assert.deepEqual(s.filters.status, ['paid']);
    assert.equal(
      s.filterHref('payer', ['p1']),
      '/claims?mineStatus=paid&status=denied&minePayer=p1'
    );
    assert.equal(s.clearFiltersHref, '/claims?status=denied');
  });
});

describe('searchStateOf', () => {
  it('adds the trimmed search text to the table state and API query', () => {
    const s = searchStateOf('/payers', new URLSearchParams('q=+blue+cross+&page=2'), spec);
    assert.equal(s.q, 'blue cross');
    assert.equal(s.apiQuery, 'q=blue%20cross&page=2&pageSize=25&sort=created&dir=desc');
    assert.equal(s.href, '/payers?q=+blue+cross+&page=2');
  });

  it('caps the search text at 80 characters', () => {
    const long = searchStateOf('/payers', new URLSearchParams({ q: 'x'.repeat(100) }), spec);
    assert.equal(long.q, 'x'.repeat(80));
  });

  it('leaves blank search text out of the API query', () => {
    const blank = searchStateOf('/payers', new URLSearchParams('q=+++'), spec);
    assert.equal(blank.q, '');
    assert.equal(blank.apiQuery, 'page=1&pageSize=25&sort=created&dir=desc');
    assert.equal(searchStateOf('/payers', new URLSearchParams(), spec).href, '/payers');
  });
});

describe('table state hooks', () => {
  const Probe = ({ prefix }: { prefix?: string }) => {
    const filtered = { ...spec, filters: ['status'] } as const;
    const table = useTableState('/claims', prefix ? { ...filtered, prefix } : filtered);
    const search = useSearchState('/claims', spec);
    return createElement(
      'output',
      null,
      [table.sort, table.page, search.q, table.filterHref('status', ['paid'])].join('|')
    );
  };

  it('reads the state from the current URL and follows navigation', () => {
    window.history.replaceState(null, '', '/claims?sort=name&page=2&q=doe');
    render(createElement(Probe));
    assert.equal(
      screen.getByRole('status').textContent,
      'name|2|doe|/claims?sort=name&q=doe&status=paid'
    );
    act(() => navigate('/claims?page=3'));
    assert.equal(screen.getByRole('status').textContent, 'created|3||/claims?status=paid');
  });

  it('resets only the page of its own table when a filter changes', () => {
    window.history.replaceState(null, '', '/claims?page=2&minePage=3');
    render(createElement(Probe, { prefix: 'mine' }));
    assert.equal(
      screen.getByRole('status').textContent,
      'created|3||/claims?page=2&mineStatus=paid'
    );
  });
});

describe('withBack', () => {
  it('records the list a page was opened from', () => {
    assert.equal(
      withBack('/payers/p1', '/payers?q=blue&page=2'),
      '/payers/p1?back=%2Fpayers%3Fq%3Dblue%26page%3D2'
    );
    assert.equal(withBack('/claims/c1', '/patients/p1'), '/claims/c1?back=%2Fpatients%2Fp1');
  });

  it('adds the back link after an existing query', () => {
    assert.equal(
      withBack('/claims/c1?tab=data', '/patients/p1'),
      '/claims/c1?tab=data&back=%2Fpatients%2Fp1'
    );
  });

  it('adds nothing when the page sits under the list without a query', () => {
    assert.equal(withBack('/payers/new', '/payers'), '/payers/new');
  });
});

describe('backOf', () => {
  it('returns to the list a page was opened from', () => {
    const to = withBack('/payers/p1', '/payers?q=blue&page=2');
    const query = new URL(to, 'http://local').searchParams;
    assert.equal(backOf(query, '/payers'), '/payers?q=blue&page=2');
    assert.equal(backOf(new URLSearchParams('back=/payers'), '/payers'), '/payers');
  });

  it('returns to an extra allowed place only when it is named', () => {
    const fromPatient = new URLSearchParams('back=/patients/p1?page=2');
    assert.equal(backOf(fromPatient, '/claims', '/patients/'), '/patients/p1?page=2');
    assert.equal(backOf(fromPatient, '/claims'), '/claims');
  });

  it('falls back to the list for missing, foreign or look-alike targets', () => {
    assert.equal(backOf(new URLSearchParams(), '/fees'), '/fees');
    assert.equal(backOf(new URLSearchParams('back=https://evil.test'), '/payers'), '/payers');
    assert.equal(backOf(new URLSearchParams('back=/payersx'), '/payers'), '/payers');
    assert.equal(backOf(new URLSearchParams('back=//evil.test'), '/claims', '/'), '/claims');
  });
});

describe('backLabelOf', () => {
  it('names the record page a back link returns to', () => {
    assert.equal(backLabelOf('/claims/c1?tab=data'), 'Back to Claim');
    assert.equal(backLabelOf('/patients/p1'), 'Back to Patient');
    assert.equal(backLabelOf('/runs/r1'), 'Back to Run');
    assert.equal(backLabelOf('/imports/i1'), 'Back to Import');
  });

  it('names the claim list', () => {
    assert.equal(backLabelOf('/claims?status=all'), 'Back to Claims');
  });
});
