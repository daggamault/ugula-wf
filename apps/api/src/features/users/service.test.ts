import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type Permission, USER_ADMIN_PERMISSIONS } from '@ugula/access';
import { hashToken } from '@ugula/auth';
import { createRecordingDb } from '@ugula/db/testing';
import type { CompiledQuery } from 'kysely';
import { testAccess } from '../../shared/testing.ts';
import { createUserService, INVITATION_DAYS } from './service.ts';

const NOW = new Date('2026-01-01T00:00:00Z');

const DAY_MS = 24 * 60 * 60 * 1000;

const member = (
  permissions: readonly string[],
  over: Partial<{ id: string; is_owner: boolean }> = {}
) => ({
  id: 'u-2',
  email: 'ada@example.com',
  first_name: 'Ada',
  last_name: 'Lovelace',
  is_owner: false,
  version: 3,
  role_id: 'r-1',
  role_name: 'Biller',
  permissions: [...permissions],
  ...over
});

type Rows = {
  member?: ReturnType<typeof member> & { total?: string };
  role?: { id: string; name: string; permissions: string[] } | undefined;
  admins?: { permissions: string[] }[];
  updated?: boolean;
  memberships?: boolean;
  isMember?: boolean;
  invitation?: { id: string; email: string; permissions: string[] } | undefined;
  invitations?: unknown[];
};

const userDb = (rows: Rows) =>
  createRecordingDb((q) => {
    const s = q.sql;
    if (s.includes('"u"."first_name"') && s.startsWith('select') && s.includes('"m"."agency_id"')) {
      return rows.member ? [rows.member] : [];
    }
    if (s.startsWith('select "m"."id"')) return rows.isMember ? [{ id: 'm-1' }] : [];
    if (s.includes('from "memberships" as "m"')) return rows.admins ?? [];
    if (s.includes('from "memberships" where "user_id"'))
      return rows.memberships ? [{ id: 'm-2' }] : [];
    if (s.includes('from "roles" as "r"')) return rows.role ? [rows.role] : [];
    if (s.startsWith('update "memberships"')) return rows.updated === false ? [] : [{ id: 'm-1' }];
    if (s.includes('order by "i"."created_at"')) return rows.invitations ?? [];
    if (s.startsWith('select') && s.includes('from "invitations"')) {
      return rows.invitation ? [rows.invitation] : [];
    }
    if (s.includes('returning "id"')) return [{ id: 'i-1' }];
    return [];
  });

const setup = (rows: Rows) => {
  const { db, queries } = userDb(rows);
  const ended: string[] = [];
  const service = createUserService({
    db,
    webUrl: 'https://app.example.com',
    now: () => NOW,
    endSessions: async (userId) => void ended.push(userId)
  });
  return { db, queries, ended, service };
};

const writes = (queries: CompiledQuery[]) =>
  queries
    .filter((q) => !q.sql.startsWith('select'))
    .map((q) => q.sql.split(' ').slice(0, 3).join(' '));

const failure = (code: string, message: string) => ({ ok: false, failure: { code, message } });

const outranked = failure('forbidden', 'This user has permissions you do not hold');

const ungrantable = failure('forbidden', "You can't give a role with permissions you don't hold");

const lastAdmin = failure('conflict', 'The agency needs at least one user who can manage users');

const tokenOf = (link: string) => new URL(link).searchParams.get('token') ?? '';

const limited = (...extra: Permission[]) =>
  testAccess(['users:read', 'users:update', 'fees:read', ...extra]);

const ROLE = '01a16617-7704-7ba6-b9b5-9c79fa44f965';

describe('user service members', () => {
  it('lists and finds members with why the caller cannot act on them', async () => {
    const { db, service } = setup({ member: { ...member(['fees:update']), total: '1' } });
    const page = await service.list(limited(), { page: 1, pageSize: 25, sort: 'name', dir: 'asc' });
    assert.ok(page.ok);
    assert.deepEqual(page.value.items[0], {
      id: 'u-2',
      email: 'ada@example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
      isOwner: false,
      version: 3,
      role: { id: 'r-1', name: 'Biller' },
      blockedReason: 'outranked'
    });
    const found = await service.find(testAccess(), 'u-2');
    assert.ok(found.ok);
    assert.equal(found.value.blockedReason, null);
    await db.destroy();
    const self = setup({ member: member([], { id: 'u-1' }) });
    const me = await self.service.find(testAccess(), 'u-1');
    assert.ok(me.ok);
    assert.equal(me.value.blockedReason, 'self');
    assert.deepEqual(
      await setup({}).service.find(testAccess(), 'u-2'),
      failure('not_found', 'User not found')
    );
    await self.db.destroy();
  });

  it('changes a member’s role under the agency lock', async () => {
    const { db, queries, service } = setup({
      member: member(['fees:read']),
      role: { id: ROLE, name: 'Viewer', permissions: ['fees:read'] }
    });
    const res = await service.update(limited(), 'u-2', { roleId: ROLE, version: 3 });
    assert.ok(res.ok);
    assert.ok(queries[0]?.sql.includes('for no key update'));
    assert.deepEqual(writes(queries), ['update "memberships" set']);
    await db.destroy();
  });

  it('refuses role changes to yourself, to outranking members and to ungrantable roles', async () => {
    const self = setup({ member: member([], { id: 'u-1' }) });
    assert.deepEqual(
      await self.service.update(testAccess(), 'u-1', { roleId: ROLE, version: 3 }),
      failure('forbidden', "You can't change your own role")
    );
    const high = setup({ member: member(['fees:update']) });
    assert.deepEqual(
      await high.service.update(limited(), 'u-2', { roleId: ROLE, version: 3 }),
      outranked
    );
    const role = setup({
      member: member([]),
      role: { id: ROLE, name: 'Admin', permissions: ['fees:update'] }
    });
    assert.deepEqual(
      await role.service.update(limited(), 'u-2', { roleId: ROLE, version: 3 }),
      ungrantable
    );
    const missing = setup({ member: member([]) });
    assert.deepEqual(
      await missing.service.update(limited(), 'u-2', { roleId: ROLE, version: 3 }),
      failure('invalid', 'Role not found')
    );
    for (const s of [self, high, role, missing]) {
      assert.deepEqual(writes(s.queries), []);
      await s.db.destroy();
    }
  });

  it('keeps the last user admin and detects stale versions', async () => {
    const last = setup({
      member: member(USER_ADMIN_PERMISSIONS),
      role: { id: ROLE, name: 'Viewer', permissions: [] }
    });
    assert.deepEqual(
      await last.service.update(testAccess(), 'u-2', { roleId: ROLE, version: 3 }),
      lastAdmin
    );
    assert.ok(last.queries.some((q) => q.sql.includes('"m"."user_id" != $')));
    const stale = setup({
      member: member([]),
      role: { id: ROLE, name: 'Viewer', permissions: [] },
      updated: false
    });
    assert.deepEqual(
      await stale.service.update(testAccess(), 'u-2', { roleId: ROLE, version: 2 }),
      failure('conflict', 'Someone else changed this user; reload and try again')
    );
    await last.db.destroy();
    await stale.db.destroy();
  });

  it('removes members and ends their sessions once they belong nowhere', async () => {
    const gone = setup({ member: member([]) });
    assert.deepEqual(await gone.service.remove(testAccess(), 'u-2'), {
      ok: true,
      value: { id: 'u-2' }
    });
    assert.deepEqual(writes(gone.queries), ['delete from "memberships"']);
    assert.deepEqual(gone.ended, ['u-2']);
    const elsewhere = setup({ member: member([]), memberships: true });
    assert.equal((await elsewhere.service.remove(testAccess(), 'u-2')).ok, true);
    assert.deepEqual(elsewhere.ended, []);
    const owner = setup({ member: member([], { is_owner: true }) });
    assert.equal((await owner.service.remove(testAccess(), 'u-2')).ok, true);
    assert.deepEqual(owner.ended, []);
    for (const s of [gone, elsewhere, owner]) await s.db.destroy();
  });

  it('refuses to remove yourself, outranking members or the last user admin', async () => {
    const self = setup({ member: member([], { id: 'u-1' }) });
    assert.deepEqual(
      await self.service.remove(testAccess(), 'u-1'),
      failure('forbidden', "You can't remove yourself")
    );
    const high = setup({ member: member(['fees:update']) });
    assert.deepEqual(await high.service.remove(limited(), 'u-2'), outranked);
    const last = setup({ member: member(USER_ADMIN_PERMISSIONS) });
    assert.deepEqual(await last.service.remove(testAccess(), 'u-2'), lastAdmin);
    for (const s of [self, high, last]) {
      assert.deepEqual(writes(s.queries), []);
      assert.deepEqual(s.ended, []);
      await s.db.destroy();
    }
  });

  it('issues a day-long password link for members the caller outranks or themselves', async () => {
    const { db, queries, service } = setup({ member: member(['fees:read']) });
    const res = await service.passwordLink(limited(), 'u-2');
    assert.ok(res.ok);
    assert.ok(res.value.link.startsWith('https://app.example.com/password?token='));
    const insert = queries.find((q) => q.sql.startsWith('insert into "password_tokens"'));
    assert.deepEqual(insert?.parameters, [
      'u-2',
      hashToken(tokenOf(res.value.link)),
      new Date(NOW.getTime() + DAY_MS)
    ]);
    await db.destroy();
    const high = setup({ member: member(['fees:update']) });
    assert.deepEqual(await high.service.passwordLink(limited(), 'u-2'), outranked);
    const owner = setup({ member: member([], { is_owner: true }) });
    assert.deepEqual(
      await owner.service.passwordLink({ ...testAccess(), isOrganizationAdmin: false }, 'u-2'),
      outranked
    );
    assert.equal(
      (await owner.service.passwordLink({ ...testAccess(), isOrganizationAdmin: true }, 'u-2')).ok,
      true
    );
    const self = setup({ member: member(['fees:update'], { id: 'u-1' }) });
    assert.equal((await self.service.passwordLink(limited(), 'u-1')).ok, true);
    assert.deepEqual(
      await setup({}).service.passwordLink(testAccess(), 'u-9'),
      failure('not_found', 'User not found')
    );
    await high.db.destroy();
    await self.db.destroy();
  });
});

describe('user service invitations', () => {
  it('lists invitations with whether they are grantable and expired', async () => {
    const row = {
      id: 'i-1',
      email: 'ada@example.com',
      first_name: 'Ada',
      last_name: 'Lovelace',
      expires_at: NOW,
      created_at: NOW,
      role_id: 'r-1',
      role_name: 'Biller',
      permissions: ['fees:update']
    };
    const { db, service } = setup({ invitations: [row] });
    assert.deepEqual(await service.invitations(limited()), {
      ok: true,
      value: {
        items: [
          {
            id: 'i-1',
            email: 'ada@example.com',
            firstName: 'Ada',
            lastName: 'Lovelace',
            role: { id: 'r-1', name: 'Biller' },
            isGrantable: false,
            isExpired: true,
            expiresAt: NOW,
            createdAt: NOW
          }
        ]
      }
    });
    await db.destroy();
  });

  const invite = { email: 'ada@example.com', firstName: 'Ada', lastName: 'Lovelace', roleId: ROLE };

  it('invites with a week-long link to a grantable role', async () => {
    const { db, queries, service } = setup({
      role: { id: ROLE, name: 'Viewer', permissions: ['fees:read'] }
    });
    const res = await service.invite(limited(), invite);
    assert.ok(res.ok);
    assert.equal(res.value.id, 'i-1');
    assert.ok(res.value.link.startsWith('https://app.example.com/invitation?token='));
    const upsert = queries.find((q) => q.sql.startsWith('insert into "invitations"'));
    assert.deepEqual(upsert?.parameters.slice(0, 8), [
      't-1',
      ROLE,
      'ada@example.com',
      'Ada',
      'Lovelace',
      hashToken(tokenOf(res.value.link)),
      'u-1',
      new Date(NOW.getTime() + INVITATION_DAYS * DAY_MS)
    ]);
    await db.destroy();
  });

  it('refuses invitations to ungrantable or missing roles and existing members', async () => {
    const high = setup({ role: { id: ROLE, name: 'Admin', permissions: ['fees:update'] } });
    assert.deepEqual(await high.service.invite(limited(), invite), ungrantable);
    const missing = setup({});
    assert.deepEqual(
      await missing.service.invite(limited(), invite),
      failure('invalid', 'Role not found')
    );
    const existing = setup({ role: { id: ROLE, name: 'Viewer', permissions: [] }, isMember: true });
    assert.deepEqual(
      await existing.service.invite(limited(), invite),
      failure('conflict', 'That person is already a user of this agency')
    );
    for (const s of [high, missing, existing]) {
      assert.deepEqual(writes(s.queries), []);
      await s.db.destroy();
    }
  });

  it('resends and removes grantable invitations only', async () => {
    const { db, queries, service } = setup({
      invitation: { id: 'i-1', email: 'ada@example.com', permissions: ['fees:read'] }
    });
    const resent = await service.resend(limited(), 'i-1');
    assert.ok(resent.ok);
    const renew = queries.find((q) => q.sql.startsWith('update "invitations"'));
    assert.equal(renew?.parameters[0], hashToken(tokenOf(resent.value.link)));
    assert.deepEqual(await service.removeInvitation(limited(), 'i-1'), {
      ok: true,
      value: { id: 'i-1' }
    });
    assert.ok(queries.some((q) => q.sql.startsWith('delete from "invitations"')));
    await db.destroy();
    const high = setup({
      invitation: { id: 'i-1', email: 'a@example.com', permissions: ['fees:update'] }
    });
    assert.deepEqual(await high.service.resend(limited(), 'i-1'), ungrantable);
    assert.deepEqual(await high.service.removeInvitation(limited(), 'i-1'), ungrantable);
    assert.deepEqual(writes(high.queries), []);
    const missing = setup({});
    const notFound = failure('not_found', 'Invitation not found');
    assert.deepEqual(await missing.service.resend(limited(), 'i-1'), notFound);
    assert.deepEqual(await missing.service.removeInvitation(limited(), 'i-1'), notFound);
    await high.db.destroy();
    await missing.db.destroy();
  });
});
