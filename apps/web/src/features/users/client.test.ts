import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApi } from '../../shared/api.ts';
import { BLOCKED_MESSAGES, createUsersClient, fullName } from './client.ts';

describe('createUsersClient', () => {
  it('calls the user and invitation endpoints and unwraps lists', async () => {
    const calls: string[] = [];
    const client = createUsersClient(
      createApi('', async (url, init = {}) => {
        calls.push(`${init.method} ${String(url)}`);
        return new Response(JSON.stringify({ items: [1], link: 'l' }), { status: 200 });
      })
    );
    await client.search('q=ann');
    await client.user('u/1');
    assert.deepEqual(await client.roles(), [1]);
    await client.setRole('u1', { roleId: 'r1', version: 2 });
    await client.remove('u1');
    assert.deepEqual(await client.passwordLink('u1'), { items: [1], link: 'l' });
    assert.deepEqual(await client.invitations(), [1]);
    await client.invite({ email: 'a@b.co', firstName: 'A', lastName: 'B', roleId: 'r1' });
    await client.resend('i1');
    await client.removeInvitation('i1');
    assert.deepEqual(calls, [
      'GET /api/users?q=ann',
      'GET /api/users/u%2F1',
      'GET /api/roles?pageSize=100&sort=name&dir=asc',
      'PUT /api/users/u1',
      'DELETE /api/users/u1',
      'POST /api/users/u1/password-link',
      'GET /api/invitations',
      'POST /api/invitations',
      'POST /api/invitations/i1/resend',
      'DELETE /api/invitations/i1'
    ]);
  });
});

describe('fullName', () => {
  it('joins first and last names', () => {
    assert.equal(fullName({ firstName: 'Ann', lastName: 'Lee' }), 'Ann Lee');
  });
});

describe('BLOCKED_MESSAGES', () => {
  it('explains why a user cannot be changed', () => {
    assert.equal(BLOCKED_MESSAGES.self, "You can't change your own access.");
    assert.match(BLOCKED_MESSAGES.outranked, /permissions you do not hold/);
  });
});
