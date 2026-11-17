import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import {
  deleteInvitation,
  deleteMember,
  findInvitation,
  findMember,
  findMemberRanks,
  findRolePermissions,
  hasMemberships,
  isMemberEmail,
  listGrantableRoles,
  renewInvitation,
  replacePasswordToken,
  searchInvitations,
  searchMembers,
  setMemberRole,
  unassignTasks,
  upsertInvitation
} from './queries.ts';

const EXPIRES = new Date('2026-01-08T00:00:00Z');

const PAGE = { page: 1, pageSize: 25, sort: 'name', dir: 'asc', role: [] } as const;

const ROLE = '01a16617-7704-7ba6-b9b5-9c79fa44f965';

const isFacet = (text: string) => text.includes('group by 1');

const ROLES = [{ value: ROLE, label: 'Biller', count: '2' }];

const ROLE_PERMISSIONS = (role: string) =>
  `coalesce((\n  select array_agg(rp.permission order by rp.permission)\n  from role_permissions rp where rp.role_id = ${role}\n), '{}')`;

const MEMBER = {
  id: 'u-1',
  email: 'ada@example.com',
  first_name: 'Ada',
  last_name: 'Lovelace',
  is_owner: false,
  version: 1,
  role_id: 'r-1',
  role_name: 'Biller',
  permissions: ['fees:read']
};

describe('member search', () => {
  it('pages the agency’s members with their role permissions by last then first name', async () => {
    const { db, queries } = createRecordingDb((q) =>
      isFacet(q.sql) ? ROLES : [{ ...MEMBER, total: '1' }]
    );
    assert.deepEqual(await searchMembers(db, 't-1', PAGE), {
      items: [MEMBER],
      total: 1,
      page: 1,
      pageSize: 25,
      facets: { role: [{ value: ROLE, label: 'Biller', count: 2 }] }
    });
    assert.equal(
      queries[0]?.sql,
      `select "u"."id", "u"."email", "u"."first_name", "u"."last_name", "u"."is_owner", "m"."version", "r"."id" as "role_id", "r"."name" as "role_name", ${ROLE_PERMISSIONS('"r"."id"')} as "permissions", count(*) over () as "total" from "memberships" as "m" inner join "users" as "u" on "u"."id" = "m"."user_id" inner join "roles" as "r" on "r"."id" = "m"."role_id" where "m"."agency_id" = $1 order by (lower(u.last_name), lower(u.first_name)) asc nulls last, "u"."id" asc limit $2 offset $3`
    );
    assert.deepEqual(queries[0]?.parameters, ['t-1', 25, 0]);
  });

  it('searches full names and emails within the agency', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await searchMembers(db, 't-1', { ...PAGE, q: ' Ada ', sort: 'email' });
    assert.ok(
      queries[0]?.sql.endsWith(
        `where "m"."agency_id" = $1 and (lower(u.first_name || ' ' || u.last_name) like $2 or "u"."email" like $3) order by "u"."email" asc nulls last, "u"."id" asc limit $4 offset $5`
      )
    );
    assert.deepEqual(queries[0]?.parameters, ['t-1', '%ada%', '%ada%', 25, 0]);
  });

  it('sorts by role name', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await searchMembers(db, 't-1', { ...PAGE, sort: 'role', dir: 'desc' });
    assert.ok(
      queries[0]?.sql.endsWith(
        'order by lower(r.name) desc nulls last, "u"."id" desc limit $2 offset $3'
      )
    );
  });

  it('filters by role and counts every role regardless of its own filter', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await searchMembers(db, 't-1', { ...PAGE, q: 'ada', role: [ROLE] });
    const [filtered, roles] = queries;
    assert.ok(filtered?.sql.includes('like $3) and "r"."id" in ($4) order by'));
    assert.deepEqual(filtered?.parameters, ['t-1', '%ada%', '%ada%', ROLE, 25, 0]);
    assert.ok(
      roles?.sql.startsWith(
        'select "r"."id"::text as "value", min("r"."name"::text) as "label", count(*) as "count" from "memberships" as "m"'
      )
    );
    assert.ok(
      roles?.sql.endsWith(
        'like $3) and "r"."id" is not null group by 1 order by count(*) desc, 1 limit $4'
      )
    );
  });
});

describe('member lookups', () => {
  it('finds a member within the agency', async () => {
    const { db, queries } = createRecordingDb(() => [MEMBER]);
    assert.deepEqual(await findMember(db, 't-1', 'u-1'), MEMBER);
    assert.ok(queries[0]?.sql.endsWith('where "m"."agency_id" = $1 and "u"."id" = $2'));
    assert.deepEqual(queries[0]?.parameters, ['t-1', 'u-1']);
  });

  it('finds a role and its permissions within the agency', async () => {
    const role = { id: 'r-1', name: 'Biller', permissions: ['fees:read'] };
    const { db, queries } = createRecordingDb(() => [role]);
    assert.deepEqual(await findRolePermissions(db, 't-1', 'r-1'), role);
    assert.equal(
      queries[0]?.sql,
      `select "r"."id", "r"."name", ${ROLE_PERMISSIONS('"r"."id"')} as "permissions" from "roles" as "r" where "r"."agency_id" = $1 and "r"."id" = $2`
    );
    assert.deepEqual(queries[0]?.parameters, ['t-1', 'r-1']);
  });

  it('lists every role of the agency by name', async () => {
    const { db, queries } = createRecordingDb(() => []);
    assert.deepEqual(await listGrantableRoles(db, 't-1'), []);
    assert.equal(
      queries[0]?.sql,
      `select "r"."id", "r"."name", ${ROLE_PERMISSIONS('"r"."id"')} as "permissions" from "roles" as "r" where "r"."agency_id" = $1 order by lower(r.name)`
    );
    assert.deepEqual(queries[0]?.parameters, ['t-1']);
  });

  it('pairs each agency of a member with the caller’s role there, if any', async () => {
    const rank = { agency_id: 't-1', permissions: ['fees:read'], held: [] };
    const { db, queries } = createRecordingDb(() => [rank]);
    assert.deepEqual(await findMemberRanks(db, 'u-2', 'u-1'), [rank]);
    assert.equal(
      queries[0]?.sql,
      `select "t"."agency_id", ${ROLE_PERMISSIONS('"t"."role_id"')} as "permissions", ${ROLE_PERMISSIONS('"r"."role_id"')} as "held" from "memberships" as "t" left join "memberships" as "r" on "r"."agency_id" = "t"."agency_id" and "r"."user_id" = $1 where "t"."user_id" = $2`
    );
    assert.deepEqual(queries[0]?.parameters, ['u-1', 'u-2']);
  });

  it('says whether a user still belongs to any agency', async () => {
    const { db, queries } = createRecordingDb(() => [{ id: 'm-1' }]);
    assert.equal(await hasMemberships(db, 'u-1'), true);
    assert.equal(queries[0]?.sql, 'select "id" from "memberships" where "user_id" = $1 limit $2');
    assert.deepEqual(queries[0]?.parameters, ['u-1', 1]);
    assert.equal(await hasMemberships(createRecordingDb(() => []).db, 'u-1'), false);
  });

  it('says whether an email belongs to a member of the agency', async () => {
    const { db, queries } = createRecordingDb(() => [{ id: 'm-1' }]);
    assert.equal(await isMemberEmail(db, 't-1', 'a@example.com'), true);
    assert.equal(
      queries[0]?.sql,
      'select "m"."id" from "memberships" as "m" inner join "users" as "u" on "u"."id" = "m"."user_id" where "m"."agency_id" = $1 and "u"."email" = $2'
    );
    assert.deepEqual(queries[0]?.parameters, ['t-1', 'a@example.com']);
    assert.equal(
      await isMemberEmail(createRecordingDb(() => []).db, 't-1', 'a@example.com'),
      false
    );
  });
});

describe('member changes', () => {
  it('changes a member’s role at the expected version within the agency', async () => {
    const { db, queries } = createRecordingDb(() => [{ id: 'm-1' }]);
    assert.deepEqual(await setMemberRole(db, 't-1', 'u-1', { roleId: 'r-2', version: 4 }), {
      id: 'm-1'
    });
    assert.equal(
      queries[0]?.sql,
      'update "memberships" set "role_id" = $1, "version" = version + 1, "updated_at" = now() where "agency_id" = $2 and "user_id" = $3 and "version" = $4 returning "id"'
    );
    assert.deepEqual(queries[0]?.parameters, ['r-2', 't-1', 'u-1', 4]);
  });

  it('removes a member from the agency only', async () => {
    const { db, queries } = createRecordingDb(() => [{ id: 'm-1' }]);
    assert.deepEqual(await deleteMember(db, 't-1', 'u-1'), { id: 'm-1' });
    assert.equal(
      queries[0]?.sql,
      'delete from "memberships" where "agency_id" = $1 and "user_id" = $2 returning "id"'
    );
    assert.deepEqual(queries[0]?.parameters, ['t-1', 'u-1']);
  });

  it('unassigns a member’s tasks in the agency only', async () => {
    const { db, queries } = createRecordingDb();
    await unassignTasks(db, 't-1', 'u-1');
    assert.equal(
      queries[0]?.sql,
      'update "tasks" set "assignee_id" = $1, "updated_at" = now() where "agency_id" = $2 and "assignee_id" = $3'
    );
    assert.deepEqual(queries[0]?.parameters, [null, 't-1', 'u-1']);
  });

  it('replaces a user’s password tokens and drops expired ones, storing only the hash', async () => {
    const { db, queries } = createRecordingDb();
    const now = new Date('2026-01-01T00:00:00Z');
    await replacePasswordToken(db, { userId: 'u-1', hash: 'h', expiresAt: EXPIRES, now });
    assert.deepEqual(
      queries.map((q) => [q.sql, q.parameters]),
      [
        [
          'delete from "password_tokens" where ("user_id" = $1 or "expires_at" <= $2)',
          ['u-1', now]
        ],
        [
          'insert into "password_tokens" ("user_id", "token_hash", "expires_at") values ($1, $2, $3)',
          ['u-1', 'h', EXPIRES]
        ]
      ]
    );
  });
});

describe('invitation queries', () => {
  const INVITATION = {
    id: 'i-1',
    email: 'ada@example.com',
    first_name: 'Ada',
    last_name: 'Lovelace',
    expires_at: EXPIRES,
    created_at: EXPIRES,
    role_id: 'r-1',
    role_name: 'Biller',
    permissions: []
  };

  it('pages the agency’s invitations with their role permissions by name', async () => {
    const { db, queries } = createRecordingDb((q) =>
      isFacet(q.sql) ? ROLES : [{ ...INVITATION, total: '1' }]
    );
    assert.deepEqual(await searchInvitations(db, 't-1', PAGE), {
      items: [INVITATION],
      total: 1,
      page: 1,
      pageSize: 25,
      facets: { role: [{ value: ROLE, label: 'Biller', count: 2 }] }
    });
    assert.equal(
      queries[0]?.sql,
      `select "i"."id", "i"."email", "i"."first_name", "i"."last_name", "i"."expires_at", "i"."created_at", "r"."id" as "role_id", "r"."name" as "role_name", ${ROLE_PERMISSIONS('"r"."id"')} as "permissions", count(*) over () as "total" from "invitations" as "i" inner join "roles" as "r" on "r"."id" = "i"."role_id" where "i"."agency_id" = $1 order by (lower(i.last_name), lower(i.first_name)) asc nulls last, "i"."id" asc limit $2 offset $3`
    );
    assert.deepEqual(queries[0]?.parameters, ['t-1', 25, 0]);
  });

  it('searches invitations by full name or email and sorts by expiry', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await searchInvitations(db, 't-1', { ...PAGE, q: 'Ada', sort: 'expires' });
    assert.ok(
      queries[0]?.sql.endsWith(
        `where "i"."agency_id" = $1 and (lower(i.first_name || ' ' || i.last_name) like $2 or "i"."email" like $3) order by "i"."expires_at" asc nulls last, "i"."id" asc limit $4 offset $5`
      )
    );
    assert.deepEqual(queries[0]?.parameters, ['t-1', '%ada%', '%ada%', 25, 0]);
  });

  it('filters invitations by role and counts their roles', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await searchInvitations(db, 't-1', { ...PAGE, role: [ROLE] });
    const [filtered, roles] = queries;
    assert.ok(filtered?.sql.includes('where "i"."agency_id" = $1 and "r"."id" in ($2) order by'));
    assert.ok(
      roles?.sql.startsWith(
        'select "r"."id"::text as "value", min("r"."name"::text) as "label", count(*) as "count" from "invitations" as "i"'
      )
    );
    assert.ok(
      roles?.sql.includes('where "i"."agency_id" = $1 and "r"."id" is not null group by 1')
    );
  });

  it('sorts invitations by email or role', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await searchInvitations(db, 't-1', { ...PAGE, sort: 'email' });
    await searchInvitations(db, 't-1', { ...PAGE, sort: 'role' });
    const [byEmail, byRole] = queries.filter((q) => !isFacet(q.sql));
    assert.ok(
      byEmail?.sql.endsWith('order by "i"."email" asc nulls last, "i"."id" asc limit $2 offset $3')
    );
    assert.ok(
      byRole?.sql.endsWith('order by lower(r.name) asc nulls last, "i"."id" asc limit $2 offset $3')
    );
  });

  it('finds an invitation and its role permissions within the agency', async () => {
    const found = { id: 'i-1', email: 'ada@example.com', permissions: [] };
    const { db, queries } = createRecordingDb(() => [found]);
    assert.deepEqual(await findInvitation(db, 't-1', 'i-1'), found);
    assert.equal(
      queries[0]?.sql,
      `select "i"."id", "i"."email", ${ROLE_PERMISSIONS('"i"."role_id"')} as "permissions" from "invitations" as "i" where "i"."agency_id" = $1 and "i"."id" = $2`
    );
    assert.deepEqual(queries[0]?.parameters, ['t-1', 'i-1']);
  });

  it('upserts one invitation per agency and email, refreshing its role, name and token', async () => {
    const { db, queries } = createRecordingDb(() => [{ id: 'i-1' }]);
    assert.deepEqual(
      await upsertInvitation(db, {
        agencyId: 't-1',
        roleId: 'r-1',
        email: 'a@example.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
        hash: 'h',
        invitedBy: 'u-1',
        expiresAt: EXPIRES
      }),
      { id: 'i-1' }
    );
    assert.equal(
      queries[0]?.sql,
      'insert into "invitations" ("agency_id", "role_id", "email", "first_name", "last_name", "token_hash", "invited_by_id", "expires_at") values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict ("agency_id", "email") do update set "role_id" = $9, "first_name" = $10, "last_name" = $11, "token_hash" = $12, "invited_by_id" = $13, "expires_at" = $14, "updated_at" = now() returning "id"'
    );
    assert.deepEqual(queries[0]?.parameters, [
      ...['t-1', 'r-1', 'a@example.com', 'Ada', 'Lovelace', 'h', 'u-1', EXPIRES],
      ...['r-1', 'Ada', 'Lovelace', 'h', 'u-1', EXPIRES]
    ]);
  });

  it('renews an invitation’s token within the agency', async () => {
    const { db, queries } = createRecordingDb(() => [{ id: 'i-1' }]);
    assert.deepEqual(await renewInvitation(db, 't-1', 'i-1', { hash: 'h2', expiresAt: EXPIRES }), {
      id: 'i-1'
    });
    assert.equal(
      queries[0]?.sql,
      'update "invitations" set "token_hash" = $1, "expires_at" = $2, "updated_at" = now() where "agency_id" = $3 and "id" = $4 returning "id"'
    );
    assert.deepEqual(queries[0]?.parameters, ['h2', EXPIRES, 't-1', 'i-1']);
  });

  it('deletes an invitation within the agency', async () => {
    const { db, queries } = createRecordingDb(() => []);
    assert.equal(await deleteInvitation(db, 't-1', 'i-1'), undefined);
    assert.equal(
      queries[0]?.sql,
      'delete from "invitations" where "agency_id" = $1 and "id" = $2 returning "id"'
    );
    assert.deepEqual(queries[0]?.parameters, ['t-1', 'i-1']);
  });
});
