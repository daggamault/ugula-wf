import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { types } from 'pg';
import { sqlExecutor, typeParsers } from './client.ts';
import { createRecordingDb } from './testing.ts';

const parse = (oid: number, value: string) =>
  (typeParsers.getTypeParser(oid, 'text') as (v: string) => unknown)(value);

describe('typeParsers', () => {
  it('keeps calendar dates as ISO strings instead of local-midnight Dates', () => {
    assert.equal(parse(types.builtins.DATE, '1980-02-29'), '1980-02-29');
  });

  it('parses every other type as pg does', () => {
    assert.equal(parse(types.builtins.INT4, '42'), 42);
    assert.equal(parse(types.builtins.INT8, '9007199254740993'), '9007199254740993');
    assert.equal(parse(types.builtins.BOOL, 't'), true);
    assert.deepEqual(
      parse(types.builtins.TIMESTAMPTZ, '2026-09-14 12:05:00+00'),
      new Date('2026-09-14T12:05:00Z')
    );
  });
});

describe('sqlExecutor', () => {
  it('runs raw parameterized SQL through the Kysely connection and returns its rows', async () => {
    const { db, queries } = createRecordingDb(() => [{ n: 1 }]);
    assert.deepEqual(await sqlExecutor(db).executeSql('select $1 as n', [1]), {
      rows: [{ n: 1 }]
    });
    assert.deepEqual(
      queries.map((q) => [q.sql, q.parameters]),
      [['select $1 as n', [1]]]
    );
    await db.destroy();
  });

  it('sends no parameters when none are given', async () => {
    const { db, queries } = createRecordingDb();
    assert.deepEqual(await sqlExecutor(db).executeSql('select 1'), { rows: [] });
    assert.deepEqual(
      queries.map((q) => [q.sql, q.parameters]),
      [['select 1', []]]
    );
    await db.destroy();
  });
});
