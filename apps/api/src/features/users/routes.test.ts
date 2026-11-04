import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ok } from '../../shared/result.ts';
import { testAccess, withSession } from '../../shared/testing.ts';
import { createInvitationRoutes, createUserRoutes } from './routes.ts';
import type { UserService } from './service.ts';

const ID = '01a16617-7704-7ba6-b9b5-9c79fa44f965';

const calls: unknown[][] = [];

const record =
  (name: string) =>
  async (...args: unknown[]) => {
    calls.push([name, ...args.slice(1)]);
    return ok({ id: ID });
  };

const service = Object.fromEntries(
  [
    'list',
    'find',
    'update',
    'remove',
    'passwordLink',
    'invitations',
    'invite',
    'resend',
    'removeInvitation'
  ].map((name) => [name, record(name)])
) as unknown as UserService;

const invite = { email: 'Ada@Example.com', firstName: 'Ada', lastName: 'Lovelace', roleId: ID };

describe('user routes', () => {
  it('lists, finds, changes roles, removes members and issues password links', async () => {
    calls.length = 0;
    const request = withSession(createUserRoutes(service));
    assert.equal((await request('/?q=ada&sort=email')).status, 200);
    assert.equal((await request(`/${ID}`)).status, 200);
    const body = JSON.stringify({ roleId: ID, version: 2 });
    assert.equal((await request(`/${ID}`, { method: 'PUT', body })).status, 200);
    assert.equal((await request(`/${ID}`, { method: 'DELETE' })).status, 200);
    assert.equal((await request(`/${ID}/password-link`, { method: 'POST' })).status, 201);
    assert.deepEqual(calls, [
      ['list', { q: 'ada', page: 1, pageSize: 25, sort: 'email', dir: 'asc' }],
      ['find', ID],
      ['update', ID, { roleId: ID, version: 2 }],
      ['remove', ID],
      ['passwordLink', ID]
    ]);
  });

  it('requires the matching users permission and valid input', async () => {
    calls.length = 0;
    const request = withSession(createUserRoutes(service), testAccess(['users:read']));
    const body = JSON.stringify({ roleId: ID, version: 2 });
    assert.equal((await request(`/${ID}`, { method: 'PUT', body })).status, 403);
    assert.equal((await request(`/${ID}`, { method: 'DELETE' })).status, 403);
    assert.equal((await request(`/${ID}/password-link`, { method: 'POST' })).status, 403);
    assert.equal((await withSession(createUserRoutes(service), testAccess([]))('/')).status, 403);
    const full = withSession(createUserRoutes(service));
    assert.equal((await full('/nope')).status, 400);
    assert.equal(
      (await full(`/${ID}`, { method: 'PUT', body: JSON.stringify({ roleId: ID }) })).status,
      400
    );
    assert.deepEqual(calls, []);
  });
});

describe('invitation routes', () => {
  it('lists, sends, resends and removes invitations', async () => {
    calls.length = 0;
    const request = withSession(createInvitationRoutes(service));
    assert.equal((await request('/')).status, 200);
    assert.equal(
      (await request('/', { method: 'POST', body: JSON.stringify(invite) })).status,
      201
    );
    assert.equal((await request(`/${ID}/resend`, { method: 'POST' })).status, 201);
    assert.equal((await request(`/${ID}`, { method: 'DELETE' })).status, 200);
    assert.deepEqual(calls, [
      ['invitations'],
      ['invite', { ...invite, email: 'ada@example.com' }],
      ['resend', ID],
      ['removeInvitation', ID]
    ]);
  });

  it('requires users permissions and a valid invitation', async () => {
    calls.length = 0;
    const request = withSession(createInvitationRoutes(service), testAccess(['users:read']));
    assert.equal(
      (await request('/', { method: 'POST', body: JSON.stringify(invite) })).status,
      403
    );
    assert.equal((await request(`/${ID}/resend`, { method: 'POST' })).status, 403);
    assert.equal((await request(`/${ID}`, { method: 'DELETE' })).status, 403);
    const full = withSession(createInvitationRoutes(service));
    const bad = JSON.stringify({ ...invite, roleId: 'nope' });
    assert.equal((await full('/', { method: 'POST', body: bad })).status, 400);
    assert.deepEqual(calls, []);
  });
});
