import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db';
import { sql } from 'kysely';
import * as v from 'valibot';
import { paged, pageEntries } from './paging.ts';

const schema = v.object(pageEntries(['created', 'name'], 'created', 'desc'));

describe('pageEntries', () => {
  it('reads page, size and a known sort from the query string, with defaults', () => {
    assert.deepEqual(v.parse(schema, {}), { page: 1, pageSize: 25, sort: 'created', dir: 'desc' });
    assert.deepEqual(v.parse(schema, { page: '3', pageSize: '100', sort: 'name', dir: 'asc' }), {
      page: 3,
      pageSize: 100,
      sort: 'name',
      dir: 'asc'
    });
    for (const bad of [{ page: '0' }, { pageSize: '30' }, { sort: 'drop table' }, { dir: 'up' }]) {
      assert.equal(v.safeParse(schema, bad).success, false, JSON.stringify(bad));
    }
  });
});

describe('paged', () => {
  const orderings = { created: sql.ref('created_at'), name: sql.ref('name') };

  it('pages in one query with a window count, stable order and nulls last', async () => {
    const { db, queries } = createRecordingDb(() => [
      { id: 'a', total: '42' },
      { id: 'b', total: '42' }
    ]);
    const page = await paged(
      db.selectFrom('graphs').select('id'),
      { page: 2, pageSize: 10, sort: 'name', dir: 'asc' },
      orderings,
      sql.ref('id')
    );
    assert.deepEqual(page, { items: [{ id: 'a' }, { id: 'b' }], total: 42, page: 2, pageSize: 10 });
    assert.equal(
      queries[0]?.sql,
      'select "id", count(*) over () as "total" from "graphs" order by "name" asc nulls last, "id" asc limit $1 offset $2'
    );
    assert.deepEqual(queries[0]?.parameters, [10, 10]);
  });

  it('still reports the total when a page is past the end', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.includes('over ()') ? [] : [{ total: '7' }]
    );
    const page = await paged(
      db.selectFrom('graphs').select('id'),
      { page: 9, pageSize: 25, sort: 'created', dir: 'desc' },
      orderings,
      sql.ref('id')
    );
    assert.deepEqual(page, { items: [], total: 7, page: 9, pageSize: 25 });
    assert.equal(queries[1]?.sql, 'select count(*) as "total" from "graphs"');
    const empty = createRecordingDb(() => []);
    const first = await paged(
      empty.db.selectFrom('graphs').select('id'),
      { page: 1, pageSize: 25, sort: 'created', dir: 'desc' },
      orderings,
      sql.ref('id')
    );
    assert.equal(first.total, 0);
    assert.equal(empty.queries.length, 1);
  });
});
