import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { types } from 'pg';
import { sqlExecutor, typeParsers } from './client.ts';
import { createRecordingDb } from './testing.ts';

describe('typeParsers', () => {
  it('keeps calendar dates as ISO strings and parses everything else as usual', () => {
    const parse = (oid: number, value: string) =>
      (typeParsers.getTypeParser(oid, 'text') as (v: string) => unknown)(value);
    assert.equal(parse(types.builtins.DATE, '1980-02-29'), '1980-02-29');
    assert.equal(parse(types.builtins.INT4, '42'), 42);
    assert.equal(parse(types.builtins.INT8, '9007199254740993'), '9007199254740993');
    assert.equal(parse(types.builtins.BOOL, 't'), true);
  });
});

describe('sqlExecutor', () => {
  it('runs raw parameterized SQL through the Kysely connection', async () => {
    const { db, queries } = createRecordingDb(() => [{ n: 1 }]);
    assert.deepEqual(await sqlExecutor(db).executeSql('select $1 as n', [1]), {
      rows: [{ n: 1 }]
    });
    await sqlExecutor(db).executeSql('select 1');
    assert.deepEqual(
      queries.map((q) => [q.sql, q.parameters]),
      [
        ['select $1 as n', [1]],
        ['select 1', []]
      ]
    );
    await db.destroy();
  });
});
