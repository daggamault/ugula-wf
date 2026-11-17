import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as v from 'valibot';
import {
  agencyTableKey,
  createTableSchema,
  searchTablesQuery,
  tableDefinitionSchema,
  tableVersionParam
} from './schemas.ts';

const issues = (schema: v.GenericSchema, input: unknown) =>
  v.safeParse(schema, input).issues?.map((i) => i.message);

describe('table schemas', () => {
  it('pages tables and shows every table by default', () => {
    assert.deepEqual(v.parse(searchTablesQuery, {}), {
      kind: [],
      scope: [],
      page: 1,
      pageSize: 25,
      sort: 'name',
      dir: 'asc'
    });
    assert.equal(v.safeParse(searchTablesQuery, { scope: 'mine' }).success, false);
    assert.deepEqual(v.parse(searchTablesQuery, { kind: 'lookup,decide' }).kind, [
      'lookup',
      'decide'
    ]);
  });

  it('limits the size of a table', () => {
    assert.deepEqual(v.parse(tableDefinitionSchema, { definition: { rows: [] } }), {
      definition: { rows: [] }
    });
    assert.deepEqual(issues(tableDefinitionSchema, { definition: 'x'.repeat(600_000) }), [
      'The table is too large to save'
    ]);
  });

  it('reads versions as positive integers', () => {
    const id = '01a16617-7704-7ba6-b9b5-9c79fa44f965';
    assert.deepEqual(v.parse(tableVersionParam, { id, version: '3' }), { id, version: 3 });
    for (const version of ['0', '1.5', 'x', '2147483648']) {
      assert.equal(v.safeParse(tableVersionParam, { id, version }).success, false, version);
    }
    assert.equal(v.safeParse(tableVersionParam, { id: 'nope', version: '1' }).success, false);
  });

  it('keys an agency table by a slug of its name that starts with a letter', () => {
    assert.equal(agencyTableKey('Mileage Rates'), 'agency.mileage-rates');
    assert.equal(agencyTableKey('2024 Rates, ALS/BLS!'), 'agency.rates-als-bls');
  });

  it('trims a new table and defaults its description', () => {
    assert.deepEqual(
      v.parse(createTableSchema, { name: ' Rates ', kind: 'lookup', definition: { rows: [] } }),
      { name: 'Rates', kind: 'lookup', description: '', definition: { rows: [] } }
    );
  });

  it('refuses a new table without a lettered name, with a long name or an unknown kind', () => {
    assert.deepEqual(issues(createTableSchema, { name: ' 123 ', kind: 'decide', definition: {} }), [
      'Use a name with at least one letter'
    ]);
    assert.deepEqual(issues(createTableSchema, { name: 'Rates', kind: 'other', definition: {} }), [
      'Invalid type: Expected ("decide" | "lookup") but received "other"'
    ]);
    assert.deepEqual(
      issues(createTableSchema, { name: 'x'.repeat(121), kind: 'decide', definition: {} }),
      ['Invalid length: Expected <=120 but received 121']
    );
  });
});
