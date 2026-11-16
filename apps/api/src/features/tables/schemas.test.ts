import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as v from 'valibot';
import { searchTablesQuery, tableDefinitionSchema, tableVersionParam } from './schemas.ts';

describe('table schemas', () => {
  it('pages tables and shows every table by default', () => {
    assert.deepEqual(v.parse(searchTablesQuery, {}), {
      show: 'all',
      page: 1,
      pageSize: 25,
      sort: 'name',
      dir: 'asc'
    });
    assert.equal(v.safeParse(searchTablesQuery, { show: 'mine' }).success, false);
    assert.equal(v.parse(searchTablesQuery, { show: 'customized' }).show, 'customized');
  });

  it('limits the size of a table', () => {
    assert.equal(v.safeParse(tableDefinitionSchema, { definition: { rows: [] } }).success, true);
    assert.equal(
      v.safeParse(tableDefinitionSchema, { definition: 'x'.repeat(600_000) }).success,
      false
    );
  });

  it('reads versions as positive integers', () => {
    const id = '01a16617-7704-7ba6-b9b5-9c79fa44f965';
    assert.deepEqual(v.parse(tableVersionParam, { id, version: '3' }), { id, version: 3 });
    assert.equal(v.safeParse(tableVersionParam, { id, version: '0' }).success, false);
  });
});
