import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApi } from '../../shared/api.ts';
import { BLOCKED_MESSAGES, createUsersClient, fullName } from './client.ts';

type Call = { method: string; url: string; body: unknown; signal: AbortSignal | undefined };

const fakeApi = (reply: unknown = {}) => {
  const calls: Call[] = [];
  const client = createUsersClient(
    createApi(
      '',
      async (url, init = {}) => {
        calls.push({
          method: String(init.method),
          url: String(url),
          body: init.body === undefined ? undefined : JSON.parse(String(init.body)),
          signal: init.signal ?? undefined
        });
        return new Response(JSON.stringify(reply), { status: 200 });
      },
      () => undefined,
      () => null
    )
  );
  return { client, calls };
};

const route = (c: Call) => `${c.method} ${c.url}`;

describe('createUsersClient', () => {
  it('searches users and invitations with the query as given', async () => {
    const { client, calls } = fakeApi({ items: [], total: 0, page: 1, pageSize: 25 });
    const signal = new AbortController().signal;
    assert.deepEqual(await client.search('q=ann&page=2', signal), {
      items: [],
      total: 0,
      page: 1,
      pageSize: 25
    });
    await client.invitations('q=bo', signal);
    assert.deepEqual(calls.map(route), [
      'GET /api/users?q=ann&page=2',
      'GET /api/invitations?q=bo'
    ]);
    assert.deepEqual(
      calls.map((c) => c.signal),
      [signal, signal]
    );
  });

  it('reads a user by its encoded id', async () => {
    const { client, calls } = fakeApi({ id: 'u/1' });
    assert.deepEqual(await client.user('u/1'), { id: 'u/1' });
    assert.deepEqual(calls.map(route), ['GET /api/users/u%2F1']);
  });

  it('unwraps the roles that can be given', async () => {
    const roles = [{ id: 'r1', name: 'Biller', isGrantable: true }];
    const { client, calls } = fakeApi({ items: roles });
    assert.deepEqual(await client.roles(), roles);
    assert.deepEqual(calls.map(route), ['GET /api/users/roles']);
  });

  it('sets a role with the version it read', async () => {
    const { client, calls } = fakeApi();
    await client.setRole('u1', { roleId: 'r2', version: 4 });
    assert.deepEqual(
      calls.map((c) => [route(c), c.body]),
      [['PUT /api/users/u1', { roleId: 'r2', version: 4 }]]
    );
  });

  it('removes a user and makes a password link for one', async () => {
    const { client, calls } = fakeApi({ link: 'http://app.test/reset?token=t' });
    await client.remove('u 1');
    assert.deepEqual(await client.passwordLink('u1'), { link: 'http://app.test/reset?token=t' });
    assert.deepEqual(
      calls.map((c) => [route(c), c.body]),
      [
        ['DELETE /api/users/u%201', undefined],
        ['POST /api/users/u1/password-link', undefined]
      ]
    );
  });

  it('invites, renews and deletes invitations', async () => {
    const { client, calls } = fakeApi({ id: 'i1', link: 'l' });
    const input = { email: 'a@b.co', firstName: 'A', lastName: 'B', roleId: 'r1' };
    assert.deepEqual(await client.invite(input), { id: 'i1', link: 'l' });
    await client.resend('i/1');
    await client.removeInvitation('i/1');
    assert.deepEqual(
      calls.map((c) => [route(c), c.body]),
      [
        ['POST /api/invitations', input],
        ['POST /api/invitations/i%2F1/resend', undefined],
        ['DELETE /api/invitations/i%2F1', undefined]
      ]
    );
  });
});

describe('fullName', () => {
  it('joins first and last names', () => {
    assert.equal(fullName({ firstName: 'Ann', lastName: 'Lee' }), 'Ann Lee');
  });
});

describe('BLOCKED_MESSAGES', () => {
  it('explains why a user cannot be changed', () => {
    assert.deepEqual(BLOCKED_MESSAGES, {
      self: "You can't change your own access.",
      outranked: 'This user has permissions you do not hold.'
    });
  });
});
