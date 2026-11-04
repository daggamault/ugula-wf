import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as v from 'valibot';
import { inviteSchema, listUsersQuery, updateUserSchema } from './schemas.ts';

const ROLE = '01a16617-7704-7ba6-b9b5-9c79fa44f965';

describe('user schemas', () => {
  it('normalizes invitations', () => {
    assert.deepEqual(
      v.parse(inviteSchema, {
        email: ' Ada@Example.com ',
        firstName: ' Ada ',
        lastName: 'Lovelace',
        roleId: ROLE
      }),
      { email: 'ada@example.com', firstName: 'Ada', lastName: 'Lovelace', roleId: ROLE }
    );
    const valid = { email: 'a@example.com', firstName: 'A', lastName: 'B', roleId: ROLE };
    assert.equal(v.safeParse(inviteSchema, { ...valid, firstName: ' ' }).success, false);
    assert.equal(v.safeParse(inviteSchema, { ...valid, roleId: 'nope' }).success, false);
    assert.equal(v.safeParse(inviteSchema, { ...valid, email: 'nope' }).success, false);
  });

  it('requires a role id and positive version to change a role', () => {
    assert.equal(v.safeParse(updateUserSchema, { roleId: ROLE, version: 1 }).success, true);
    assert.equal(v.safeParse(updateUserSchema, { roleId: ROLE, version: 0 }).success, false);
    assert.equal(v.safeParse(updateUserSchema, { roleId: 'r', version: 1 }).success, false);
  });

  it('pages users by name ascending by default', () => {
    assert.deepEqual(v.parse(listUsersQuery, { sort: 'role' }), {
      page: 1,
      pageSize: 25,
      sort: 'role',
      dir: 'asc'
    });
    assert.equal(v.safeParse(listUsersQuery, { sort: 'nope' }).success, false);
  });
});
