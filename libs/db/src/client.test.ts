import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Kysely } from 'kysely';
import { types } from 'pg';
import { createDb, sqlExecutor, typeParsers } from './client.ts';
import { createDummyDb } from './testing.ts';

describe('createDb', () => {
  it('creates a Kysely database instance', async () => {
    const db = createDb({ host: 'localhost', port: 5432, database: 'ugula' });
    assert.ok(db instanceof Kysely);
    await db.destroy();
  });
});

describe('typeParsers', () => {
  it('keeps calendar dates as ISO strings and parses everything else as usual', () => {
    const parse = (oid: number, value: string) =>
      (typeParsers.getTypeParser(oid, 'text') as (v: string) => unknown)(value);
    assert.equal(parse(types.builtins.DATE, '1980-02-29'), '1980-02-29');
    assert.equal(parse(types.builtins.INT4, '42'), 42);
  });
});

describe('sqlExecutor', () => {
  it('runs raw parameterized SQL through the Kysely connection', async () => {
    const db = createDummyDb();
    assert.deepEqual(await sqlExecutor(db).executeSql('select $1', [1]), { rows: [] });
    await db.destroy();
  });
});
