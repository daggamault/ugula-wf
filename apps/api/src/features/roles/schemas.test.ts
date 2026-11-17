import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as v from 'valibot';
import { roleSchema, searchRolesQuery, updateRoleSchema } from './schemas.ts';

const issues = (schema: v.GenericSchema, input: unknown) =>
  v.safeParse(schema, input).issues?.map((i) => i.message);

describe('roleSchema', () => {
  it('trims names and dedupes and sorts permissions', () => {
    assert.deepEqual(
      v.parse(roleSchema, {
        name: ' Biller ',
        permissions: ['fees:update', 'fees:read', 'fees:update']
      }),
      { name: 'Biller', permissions: ['fees:read', 'fees:update'] }
    );
  });

  it('accepts a role with no permissions', () => {
    assert.deepEqual(v.parse(roleSchema, { name: 'Viewer', permissions: [] }), {
      name: 'Viewer',
      permissions: []
    });
  });

  it('asks for a name of at most 80 characters', () => {
    assert.deepEqual(issues(roleSchema, { name: ' ', permissions: [] }), ['Enter a name']);
    assert.deepEqual(issues(roleSchema, { name: 'x'.repeat(81), permissions: [] }), [
      'Invalid length: Expected <=80 but received 81'
    ]);
  });

  it('rejects unknown permissions', () => {
    assert.equal(v.safeParse(roleSchema, { name: 'x', permissions: ['nope'] }).success, false);
  });
});

describe('updateRoleSchema', () => {
  it('takes the role with the version it was read at', () => {
    assert.deepEqual(
      v.parse(updateRoleSchema, { name: ' x ', permissions: ['fees:read'], version: 1 }),
      { name: 'x', permissions: ['fees:read'], version: 1 }
    );
  });

  it('requires a positive whole version', () => {
    assert.deepEqual(issues(updateRoleSchema, { name: 'x', permissions: [], version: 0 }), [
      'Invalid value: Expected >=1 but received 0'
    ]);
    assert.deepEqual(issues(updateRoleSchema, { name: 'x', permissions: [], version: 1.5 }), [
      'Invalid integer: Received 1.5'
    ]);
    assert.deepEqual(issues(updateRoleSchema, { name: 'x', permissions: [] }), [
      'Invalid key: Expected "version" but received undefined'
    ]);
  });
});

describe('searchRolesQuery', () => {
  it('pages roles by name ascending by default', () => {
    assert.deepEqual(v.parse(searchRolesQuery, {}), {
      page: 1,
      pageSize: 25,
      sort: 'name',
      dir: 'asc'
    });
  });

  it('sorts by users or last change with trimmed search text', () => {
    assert.deepEqual(v.parse(searchRolesQuery, { q: ' bill ', sort: 'users', dir: 'desc' }), {
      q: 'bill',
      page: 1,
      pageSize: 25,
      sort: 'users',
      dir: 'desc'
    });
    assert.equal(v.parse(searchRolesQuery, { sort: 'updated' }).sort, 'updated');
  });

  it('rejects unknown sorts', () => {
    assert.equal(v.safeParse(searchRolesQuery, { sort: 'nope' }).success, false);
  });
});
