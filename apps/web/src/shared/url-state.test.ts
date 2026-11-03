import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { backOf, hrefWith, pageOf, searchStateOf, tableStateOf, withBack } from './url-state.ts';

const spec = { sorts: { created: 'desc', name: 'asc' }, sort: 'created' } as const;

const state = (search: string, prefix?: string) =>
  tableStateOf('/claims', new URLSearchParams(search), prefix ? { ...spec, prefix } : spec);

describe('hrefWith', () => {
  it('sets and removes params while keeping the rest', () => {
    const q = new URLSearchParams('status=paid&page=2');
    assert.equal(
      hrefWith('/claims', q, { page: null, sort: 'name' }),
      '/claims?status=paid&sort=name'
    );
    assert.equal(hrefWith('/claims', new URLSearchParams(), {}), '/claims');
  });
});

describe('tableStateOf', () => {
  it('reads sort, direction, page and size from the URL and falls back to defaults', () => {
    const s = state('sort=name&dir=desc&page=3&pageSize=50');
    assert.deepEqual([s.sort, s.dir, s.page, s.pageSize], ['name', 'desc', 3, 50]);
    const d = state('sort=evil&dir=sideways&page=-1&pageSize=7');
    assert.deepEqual([d.sort, d.dir, d.page, d.pageSize], ['created', 'desc', 1, 25]);
    assert.equal(state('sort=name').dir, 'asc');
    assert.equal(s.apiQuery, 'page=3&pageSize=50&sort=name&dir=desc');
  });

  it('links each header to its sort, flips the current one and resets the page', () => {
    const s = state('status=paid&page=3');
    assert.equal(s.sortHref('name'), '/claims?status=paid&sort=name&dir=asc');
    assert.equal(s.sortHref('created'), '/claims?status=paid&sort=created&dir=asc');
    assert.equal(state('sort=created&dir=asc').sortHref('created'), '/claims');
    assert.equal(state('sort=name&dir=asc').sortHref('name'), '/claims?sort=name&dir=desc');
    assert.equal(state('').sortTo('name', 'desc'), '/claims?sort=name&dir=desc');
    assert.equal(state('sort=name').sortTo('created', 'desc'), '/claims');
  });

  it('links pages and sizes, leaving defaults out of the URL', () => {
    const s = state('status=paid&page=2');
    assert.equal(s.pageHref(3), '/claims?status=paid&page=3');
    assert.equal(s.pageHref(1), '/claims?status=paid');
    assert.equal(s.sizeHref(100), '/claims?status=paid&pageSize=100');
    assert.equal(s.sizeHref(25), '/claims?status=paid');
  });

  it('keeps several tables on one page apart with a prefix', () => {
    const s = state('mineSort=name&minePage=2&page=4', 'mine');
    assert.deepEqual([s.sort, s.page], ['name', 2]);
    assert.equal(s.pageHref(3), '/claims?mineSort=name&minePage=3&page=4');
  });
});

describe('pageOf', () => {
  const rows = [
    { name: 'b', total: 2 },
    { name: 'A10', total: null },
    { name: 'a2', total: 9 },
    { name: 'c', total: 1 }
  ];
  const values = {
    name: (r: (typeof rows)[number]) => r.name,
    total: (r: (typeof rows)[number]) => r.total
  };

  it('sorts naturally with empty values last in either direction, then pages', () => {
    const by = (sort: 'name' | 'total', dir: 'asc' | 'desc', page = 1, pageSize = 10) =>
      pageOf(rows, { sort, dir, page, pageSize }, values).items.map((r) => r.name);
    assert.deepEqual(by('name', 'asc'), ['a2', 'A10', 'b', 'c']);
    assert.deepEqual(by('total', 'desc'), ['a2', 'b', 'c', 'A10']);
    assert.deepEqual(by('total', 'asc'), ['c', 'b', 'a2', 'A10']);
    assert.deepEqual(by('name', 'asc', 2, 3), ['c']);
    assert.equal(pageOf(rows, { sort: 'name', dir: 'asc', page: 2, pageSize: 3 }, values).total, 4);
  });
});

describe('searchStateOf', () => {
  it('adds the trimmed search text to the table state and API query', () => {
    const s = searchStateOf('/payers', new URLSearchParams('q=+blue+cross+&page=2'), spec);
    assert.equal(s.q, 'blue cross');
    assert.equal(s.apiQuery, 'q=blue%20cross&page=2&pageSize=25&sort=created&dir=desc');
    assert.equal(s.href, '/payers?q=+blue+cross+&page=2');
    assert.equal(searchStateOf('/payers', new URLSearchParams(), spec).href, '/payers');
  });
});

describe('withBack and backOf', () => {
  it('returns to the list a page was opened from, never anywhere else', () => {
    const to = withBack('/payers/p1', '/payers?q=blue&page=2');
    assert.equal(to, '/payers/p1?back=%2Fpayers%3Fq%3Dblue%26page%3D2');
    const query = new URL(to, 'http://local').searchParams;
    assert.equal(backOf(query, '/payers'), '/payers?q=blue&page=2');
    assert.equal(withBack('/payers/new', '/payers'), '/payers/new');
    assert.equal(withBack('/claims/c1', '/patients/p1'), '/claims/c1?back=%2Fpatients%2Fp1');
    const fromPatient = new URLSearchParams('back=/patients/p1?page=2');
    assert.equal(backOf(fromPatient, '/claims', '/patients/'), '/patients/p1?page=2');
    assert.equal(backOf(fromPatient, '/claims'), '/claims');
    assert.equal(backOf(new URLSearchParams('back=https://evil.test'), '/payers'), '/payers');
    assert.equal(backOf(new URLSearchParams('back=/payersx'), '/payers'), '/payers');
    assert.equal(backOf(new URLSearchParams(), '/fees'), '/fees');
  });
});
