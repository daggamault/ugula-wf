import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Kysely } from 'kysely';
import { createDummyDb, createRecordingDb } from './testing.ts';

describe('createDummyDb', () => {
  it('compiles Postgres queries without a connection', async () => {
    const db = createDummyDb();
    assert.ok(db instanceof Kysely);
    const query = db.selectFrom('users').select('id').where('id', '=', 'u1').compile();
    assert.deepEqual(
      [query.sql, query.parameters],
      ['select "id" from "users" where "id" = $1', ['u1']]
    );
    await db.destroy();
  });

  it('answers executed queries with no rows', async () => {
    const db = createDummyDb();
    assert.deepEqual(await db.selectFrom('users').select('id').execute(), []);
    await db.destroy();
  });
});

describe('createRecordingDb', () => {
  it('records each compiled query with its parameters, in order', async () => {
    const { db, queries } = createRecordingDb();
    await db.selectFrom('users').select('id').where('id', '=', 'u1').execute();
    await db.deleteFrom('users').execute();
    assert.deepEqual(
      queries.map((q) => [q.sql, q.parameters]),
      [
        ['select "id" from "users" where "id" = $1', ['u1']],
        ['delete from "users"', []]
      ]
    );
    await db.destroy();
  });

  it('answers each query with the rows rowsFor gives it', async () => {
    const { db } = createRecordingDb((q) => (q.sql.startsWith('select') ? [{ id: 'x' }] : []));
    assert.deepEqual(await db.selectFrom('users').select('id').execute(), [{ id: 'x' }]);
    assert.deepEqual(await db.deleteFrom('users').returning('id').execute(), []);
    await db.destroy();
  });

  it('reports as many affected rows as it answers with', async () => {
    const { db } = createRecordingDb(() => [{}, {}]);
    const result = await db.deleteFrom('users').executeTakeFirst();
    assert.equal(result.numDeletedRows, 2n);
    await db.destroy();
  });

  it('answers with no rows by default', async () => {
    const { db } = createRecordingDb();
    assert.deepEqual(await db.selectFrom('users').select('id').execute(), []);
    await db.destroy();
  });
});
