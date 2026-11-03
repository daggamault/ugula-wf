import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Kysely } from 'kysely';
import { createDummyDb, createRecordingDb } from './testing.ts';

describe('createDummyDb', () => {
  it('compiles queries without a connection', async () => {
    const db = createDummyDb();
    assert.ok(db instanceof Kysely);
    assert.equal(db.selectFrom('users').select('id').compile().sql, 'select "id" from "users"');
    await db.destroy();
  });
});

describe('createRecordingDb', () => {
  it('records compiled queries and answers with canned rows', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('select') ? [{ id: 'x' }] : []
    );
    assert.deepEqual(await db.selectFrom('users').select('id').execute(), [{ id: 'x' }]);
    await db.deleteFrom('users').execute();
    assert.deepEqual(
      queries.map((q) => q.sql),
      ['select "id" from "users"', 'delete from "users"']
    );
    await db.destroy();
  });
});
