import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fail, ok } from '../../shared/result.ts';
import { testAccess, withSession } from '../../shared/testing.ts';
import { createInvitationRoutes, createUserRoutes } from './routes.ts';
import type { UserService } from './service.ts';

const ID = '01a16617-7704-7ba6-b9b5-9c79fa44f965';

const FORBIDDEN = { error: 'You do not have permission to do this' };

const BAD_ID = {
  error: 'id: Invalid UUID: Received "nope"',
  issues: ['id: Invalid UUID: Received "nope"']
};

const METHODS = [
  'search',
  'find',
  'update',
  'remove',
  'passwordLink',
  'roles',
  'invitations',
  'invite',
  'resend',
  'removeInvitation'
];

const recordingService = () => {
  const calls: unknown[][] = [];
  const service = Object.fromEntries(
    METHODS.map((name) => [
      name,
      async (...args: unknown[]) => {
        calls.push([name, ...args]);
        return ok({ called: name });
      }
    ])
  ) as unknown as UserService;
  return { service, calls };
};

const send = async (
  request: ReturnType<typeof withSession>,
  path: string,
  init: RequestInit = {}
) => {
  const res = await request(path, init);
  return [res.status, await res.json()];
};

const invite = { email: 'Ada@Example.com', firstName: 'Ada', lastName: 'Lovelace', roleId: ID };

describe('user routes', () => {
  it('searches members with paging defaults for the session access', async () => {
    const { service, calls } = recordingService();
    const access = testAccess();
    const request = withSession(createUserRoutes(service), access);
    assert.deepEqual(await send(request, `/?q=ada&sort=email&role=${ID}`), [
      200,
      { called: 'search' }
    ]);
    assert.deepEqual(calls, [
      ['search', access, { q: 'ada', role: [ID], page: 1, pageSize: 25, sort: 'email', dir: 'asc' }]
    ]);
  });

  it('lists the roles to choose from', async () => {
    const { service, calls } = recordingService();
    const access = testAccess();
    const request = withSession(createUserRoutes(service), access);
    assert.deepEqual(await send(request, '/roles'), [200, { called: 'roles' }]);
    assert.deepEqual(calls, [['roles', access]]);
  });

  it('finds a member', async () => {
    const { service, calls } = recordingService();
    const access = testAccess();
    const request = withSession(createUserRoutes(service), access);
    assert.deepEqual(await send(request, `/${ID}`), [200, { called: 'find' }]);
    assert.deepEqual(calls, [['find', access, ID]]);
  });

  it('changes a member’s role at a version', async () => {
    const { service, calls } = recordingService();
    const access = testAccess();
    const request = withSession(createUserRoutes(service), access);
    assert.deepEqual(
      await send(request, `/${ID}`, {
        method: 'PUT',
        body: JSON.stringify({ roleId: ID, version: 2 })
      }),
      [200, { called: 'update' }]
    );
    assert.deepEqual(calls, [['update', access, ID, { roleId: ID, version: 2 }]]);
  });

  it('removes a member', async () => {
    const { service, calls } = recordingService();
    const access = testAccess();
    const request = withSession(createUserRoutes(service), access);
    assert.deepEqual(await send(request, `/${ID}`, { method: 'DELETE' }), [
      200,
      { called: 'remove' }
    ]);
    assert.deepEqual(calls, [['remove', access, ID]]);
  });

  it('issues a password link with 201', async () => {
    const { service, calls } = recordingService();
    const access = testAccess();
    const request = withSession(createUserRoutes(service), access);
    assert.deepEqual(await send(request, `/${ID}/password-link`, { method: 'POST' }), [
      201,
      { called: 'passwordLink' }
    ]);
    assert.deepEqual(calls, [['passwordLink', access, ID]]);
  });

  it('maps service failures to their status and message', async () => {
    const failing = {
      find: async () => fail('not_found', 'User not found'),
      update: async () => fail('conflict', 'This user changed. Reload and try again')
    } as unknown as UserService;
    const request = withSession(createUserRoutes(failing));
    assert.deepEqual(await send(request, `/${ID}`), [404, { error: 'User not found' }]);
    assert.deepEqual(
      await send(request, `/${ID}`, {
        method: 'PUT',
        body: JSON.stringify({ roleId: ID, version: 2 })
      }),
      [409, { error: 'This user changed. Reload and try again' }]
    );
  });

  it('reads members and roles with users:read only', async () => {
    const { service, calls } = recordingService();
    const none = withSession(createUserRoutes(service), testAccess([]));
    for (const path of ['/', '/roles', `/${ID}`]) {
      assert.deepEqual(await send(none, path), [403, FORBIDDEN], path);
    }
    const reader = withSession(createUserRoutes(service), testAccess(['users:read']));
    for (const path of ['/', '/roles', `/${ID}`]) {
      assert.equal((await reader(path)).status, 200, path);
    }
    assert.deepEqual(
      calls.map(([name]) => name),
      ['search', 'roles', 'find']
    );
  });

  it('changes roles and issues links with users:update and removes with users:delete', async () => {
    const { service, calls } = recordingService();
    const body = JSON.stringify({ roleId: ID, version: 2 });
    const reader = withSession(createUserRoutes(service), testAccess(['users:read']));
    assert.deepEqual(await send(reader, `/${ID}`, { method: 'PUT', body }), [403, FORBIDDEN]);
    assert.deepEqual(await send(reader, `/${ID}`, { method: 'DELETE' }), [403, FORBIDDEN]);
    assert.deepEqual(await send(reader, `/${ID}/password-link`, { method: 'POST' }), [
      403,
      FORBIDDEN
    ]);
    assert.equal(calls.length, 0);
    const updater = withSession(createUserRoutes(service), testAccess(['users:update']));
    assert.equal((await updater(`/${ID}`, { method: 'PUT', body })).status, 200);
    assert.equal((await updater(`/${ID}/password-link`, { method: 'POST' })).status, 201);
    assert.equal((await updater(`/${ID}`, { method: 'DELETE' })).status, 403);
    const deleter = withSession(createUserRoutes(service), testAccess(['users:delete']));
    assert.equal((await deleter(`/${ID}`, { method: 'DELETE' })).status, 200);
    assert.deepEqual(
      calls.map(([name]) => name),
      ['update', 'passwordLink', 'remove']
    );
  });

  it('rejects ids that are not UUIDs and role changes without a version', async () => {
    const { service, calls } = recordingService();
    const request = withSession(createUserRoutes(service));
    for (const [path, init] of [
      ['/nope', {}],
      ['/nope', { method: 'DELETE' }],
      ['/nope/password-link', { method: 'POST' }]
    ] as const) {
      assert.deepEqual(await send(request, path, init), [400, BAD_ID], path);
    }
    assert.deepEqual(
      await send(request, `/${ID}`, { method: 'PUT', body: JSON.stringify({ roleId: ID }) }),
      [
        400,
        {
          error: 'version: Invalid key: Expected "version" but received undefined',
          issues: ['version: Invalid key: Expected "version" but received undefined']
        }
      ]
    );
    assert.equal(calls.length, 0);
  });
});

describe('invitation routes', () => {
  it('searches invitations, soonest expiry first by default', async () => {
    const { service, calls } = recordingService();
    const access = testAccess();
    const request = withSession(createInvitationRoutes(service), access);
    assert.deepEqual(await send(request, `/?q=ada&role=${ID}`), [200, { called: 'invitations' }]);
    assert.deepEqual(calls, [
      [
        'invitations',
        access,
        { q: 'ada', role: [ID], page: 1, pageSize: 25, sort: 'expires', dir: 'asc' }
      ]
    ]);
  });

  it('sends an invitation with a normalized email and 201', async () => {
    const { service, calls } = recordingService();
    const access = testAccess();
    const request = withSession(createInvitationRoutes(service), access);
    assert.deepEqual(await send(request, '/', { method: 'POST', body: JSON.stringify(invite) }), [
      201,
      { called: 'invite' }
    ]);
    assert.deepEqual(calls, [['invite', access, { ...invite, email: 'ada@example.com' }]]);
  });

  it('resends an invitation with 201 and removes one', async () => {
    const { service, calls } = recordingService();
    const access = testAccess();
    const request = withSession(createInvitationRoutes(service), access);
    assert.deepEqual(await send(request, `/${ID}/resend`, { method: 'POST' }), [
      201,
      { called: 'resend' }
    ]);
    assert.deepEqual(await send(request, `/${ID}`, { method: 'DELETE' }), [
      200,
      { called: 'removeInvitation' }
    ]);
    assert.deepEqual(calls, [
      ['resend', access, ID],
      ['removeInvitation', access, ID]
    ]);
  });

  it('lists with users:read, sends and resends with users:create and removes with users:delete', async () => {
    const { service, calls } = recordingService();
    const body = JSON.stringify(invite);
    const none = withSession(createInvitationRoutes(service), testAccess([]));
    assert.deepEqual(await send(none, '/'), [403, FORBIDDEN]);
    const reader = withSession(createInvitationRoutes(service), testAccess(['users:read']));
    assert.deepEqual(await send(reader, '/', { method: 'POST', body }), [403, FORBIDDEN]);
    assert.deepEqual(await send(reader, `/${ID}/resend`, { method: 'POST' }), [403, FORBIDDEN]);
    assert.deepEqual(await send(reader, `/${ID}`, { method: 'DELETE' }), [403, FORBIDDEN]);
    assert.equal(calls.length, 0);
    const creator = withSession(createInvitationRoutes(service), testAccess(['users:create']));
    assert.equal((await creator('/', { method: 'POST', body })).status, 201);
    assert.equal((await creator(`/${ID}/resend`, { method: 'POST' })).status, 201);
    assert.equal((await creator(`/${ID}`, { method: 'DELETE' })).status, 403);
    const deleter = withSession(createInvitationRoutes(service), testAccess(['users:delete']));
    assert.equal((await deleter(`/${ID}`, { method: 'DELETE' })).status, 200);
    assert.deepEqual(
      calls.map(([name]) => name),
      ['invite', 'resend', 'removeInvitation']
    );
  });

  it('rejects invalid invitations and ids', async () => {
    const { service, calls } = recordingService();
    const request = withSession(createInvitationRoutes(service));
    assert.deepEqual(
      await send(request, '/', {
        method: 'POST',
        body: JSON.stringify({ ...invite, roleId: 'nope' })
      }),
      [
        400,
        {
          error: 'roleId: Invalid UUID: Received "nope"',
          issues: ['roleId: Invalid UUID: Received "nope"']
        }
      ]
    );
    assert.equal((await send(request, '/?role=nope'))[0], 400);
    assert.deepEqual(await send(request, '/nope/resend', { method: 'POST' }), [400, BAD_ID]);
    assert.deepEqual(await send(request, '/nope', { method: 'DELETE' }), [400, BAD_ID]);
    assert.equal(calls.length, 0);
  });
});
