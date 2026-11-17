import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { sql } from 'kysely';
import * as v from 'valibot';
import { paged, pageEntries } from './paging.ts';

const schema = v.object(pageEntries(['created', 'name'], 'created', 'desc'));

const orderings = { created: sql.ref('created_at'), name: sql.ref('name') };

describe('pageEntries', () => {
  it('defaults to the first page of 25 in the given sort and direction', () => {
    assert.deepEqual(v.parse(schema, {}), { page: 1, pageSize: 25, sort: 'created', dir: 'desc' });
  });

  it('reads page, size and a known sort from the query string', () => {
    assert.deepEqual(v.parse(schema, { page: '3', pageSize: '100', sort: 'name', dir: 'asc' }), {
      page: 3,
      pageSize: 100,
      sort: 'name',
      dir: 'asc'
    });
  });

  it('takes only the listed page sizes', () => {
    for (const pageSize of ['10', '25', '50', '100']) {
      assert.equal(v.parse(schema, { pageSize }).pageSize, Number(pageSize));
    }
    assert.equal(v.safeParse(schema, { pageSize: '30' }).success, false);
  });

  it('rejects pages outside 1..1,000,000, unknown sorts and directions', () => {
    for (const bad of [
      { page: '0' },
      { page: '1.5' },
      { page: '1000001' },
      { sort: 'drop table' },
      { dir: 'up' }
    ]) {
      assert.equal(v.safeParse(schema, bad).success, false, JSON.stringify(bad));
    }
    assert.equal(v.parse(schema, { page: '1000000' }).page, 1_000_000);
  });
});

describe('paged', () => {
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
    assert.equal(queries.length, 1);
  });

  it('orders descending with the tiebreak in the same direction', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await paged(
      db.selectFrom('graphs').select('id'),
      { page: 1, pageSize: 25, sort: 'created', dir: 'desc' },
      orderings,
      sql.ref('id')
    );
    assert.equal(
      queries[0]?.sql,
      'select "id", count(*) over () as "total" from "graphs" order by "created_at" desc nulls last, "id" desc limit $1 offset $2'
    );
    assert.deepEqual(queries[0]?.parameters, [25, 0]);
  });

  it('counts separately when a page is past the end', async () => {
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
    assert.deepEqual(queries[1]?.parameters, []);
  });

  it('reports zero when the separate count finds nothing', async () => {
    const { db } = createRecordingDb(() => []);
    const page = await paged(
      db.selectFrom('graphs').select('id'),
      { page: 2, pageSize: 25, sort: 'created', dir: 'desc' },
      orderings,
      sql.ref('id')
    );
    assert.deepEqual(page, { items: [], total: 0, page: 2, pageSize: 25 });
  });

  it('knows an empty first page has no rows without counting again', async () => {
    const { db, queries } = createRecordingDb(() => []);
    const page = await paged(
      db.selectFrom('graphs').select('id'),
      { page: 1, pageSize: 25, sort: 'created', dir: 'desc' },
      orderings,
      sql.ref('id')
    );
    assert.deepEqual(page, { items: [], total: 0, page: 1, pageSize: 25 });
    assert.equal(queries.length, 1);
  });
});
