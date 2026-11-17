import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as v from 'valibot';
import {
  inviteSchema,
  searchInvitationsQuery,
  searchMembersQuery,
  updateUserSchema
} from './schemas.ts';

const ROLE = '01a16617-7704-7ba6-b9b5-9c79fa44f965';

const VALID = { email: 'a@example.com', firstName: 'A', lastName: 'B', roleId: ROLE };

const issues = (schema: v.GenericSchema, input: unknown) =>
  v.safeParse(schema, input).issues?.map((i) => i.message);

describe('inviteSchema', () => {
  it('trims and lowercases the email and trims names', () => {
    assert.deepEqual(
      v.parse(inviteSchema, {
        email: ' Ada@Example.com ',
        firstName: ' Ada ',
        lastName: ' Lovelace ',
        roleId: ROLE
      }),
      { email: 'ada@example.com', firstName: 'Ada', lastName: 'Lovelace', roleId: ROLE }
    );
  });

  it('asks for first and last names of at most 80 characters', () => {
    assert.deepEqual(issues(inviteSchema, { ...VALID, firstName: ' ' }), ['Enter a name']);
    assert.deepEqual(issues(inviteSchema, { ...VALID, lastName: '' }), ['Enter a name']);
    assert.deepEqual(issues(inviteSchema, { ...VALID, lastName: 'x'.repeat(81) }), [
      'Invalid length: Expected <=80 but received 81'
    ]);
  });

  it('rejects malformed emails and role ids', () => {
    assert.deepEqual(issues(inviteSchema, { ...VALID, email: 'nope' }), [
      'Invalid email: Received "nope"'
    ]);
    assert.deepEqual(issues(inviteSchema, { ...VALID, roleId: 'nope' }), [
      'Invalid UUID: Received "nope"'
    ]);
  });
});

describe('updateUserSchema', () => {
  it('takes a role id and the membership version it was read at', () => {
    assert.deepEqual(v.parse(updateUserSchema, { roleId: ROLE, version: 1 }), {
      roleId: ROLE,
      version: 1
    });
  });

  it('requires a UUID role and a positive whole version', () => {
    assert.deepEqual(issues(updateUserSchema, { roleId: 'r', version: 1 }), [
      'Invalid UUID: Received "r"'
    ]);
    assert.deepEqual(issues(updateUserSchema, { roleId: ROLE, version: 0 }), [
      'Invalid value: Expected >=1 but received 0'
    ]);
    assert.deepEqual(issues(updateUserSchema, { roleId: ROLE, version: 1.5 }), [
      'Invalid integer: Received 1.5'
    ]);
  });
});

describe('searchMembersQuery', () => {
  it('pages users by name ascending by default', () => {
    assert.deepEqual(v.parse(searchMembersQuery, {}), {
      page: 1,
      pageSize: 25,
      sort: 'name',
      dir: 'asc'
    });
  });

  it('sorts by email or role with trimmed search text', () => {
    assert.deepEqual(v.parse(searchMembersQuery, { q: ' ada ', sort: 'role', dir: 'desc' }), {
      q: 'ada',
      page: 1,
      pageSize: 25,
      sort: 'role',
      dir: 'desc'
    });
    assert.equal(v.parse(searchMembersQuery, { sort: 'email' }).sort, 'email');
  });

  it('rejects unknown sorts', () => {
    assert.equal(v.safeParse(searchMembersQuery, { sort: 'expires' }).success, false);
  });
});

describe('searchInvitationsQuery', () => {
  it('pages invitations by soonest expiry by default', () => {
    assert.deepEqual(v.parse(searchInvitationsQuery, { q: ' Ada ' }), {
      q: 'Ada',
      page: 1,
      pageSize: 25,
      sort: 'expires',
      dir: 'asc'
    });
  });

  it('sorts by name, email or role and rejects other sorts', () => {
    for (const sort of ['name', 'email', 'role']) {
      assert.equal(v.parse(searchInvitationsQuery, { sort }).sort, sort);
    }
    assert.equal(v.safeParse(searchInvitationsQuery, { sort: 'created' }).success, false);
  });
});
