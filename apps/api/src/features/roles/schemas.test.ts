import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as v from 'valibot';
import { roleSchema, searchRolesQuery, updateRoleSchema } from './schemas.ts';

describe('role schemas', () => {
  it('trims names and dedupes and sorts permissions', () => {
    assert.deepEqual(
      v.parse(roleSchema, {
        name: ' Biller ',
        permissions: ['fees:update', 'fees:read', 'fees:update']
      }),
      { name: 'Biller', permissions: ['fees:read', 'fees:update'] }
    );
    assert.equal(v.safeParse(roleSchema, { name: ' ', permissions: [] }).success, false);
    assert.equal(v.safeParse(roleSchema, { name: 'x', permissions: ['nope'] }).success, false);
  });

  it('requires a positive version to update', () => {
    assert.equal(
      v.safeParse(updateRoleSchema, { name: 'x', permissions: [], version: 1 }).success,
      true
    );
    assert.equal(
      v.safeParse(updateRoleSchema, { name: 'x', permissions: [], version: 0 }).success,
      false
    );
    assert.equal(v.safeParse(updateRoleSchema, { name: 'x', permissions: [] }).success, false);
  });

  it('pages roles by name ascending by default', () => {
    assert.deepEqual(v.parse(searchRolesQuery, {}), {
      page: 1,
      pageSize: 25,
      sort: 'name',
      dir: 'asc'
    });
    assert.equal(v.safeParse(searchRolesQuery, { sort: 'nope' }).success, false);
  });
});
