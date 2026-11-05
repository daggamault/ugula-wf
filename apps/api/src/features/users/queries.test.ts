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
  upsertInvitation
} from './queries.ts';

const EXPIRES = new Date('2026-01-08T00:00:00Z');

describe('member queries', () => {
  it('searches the agency’s members by name or email with their role permissions', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await searchMembers(db, 't-1', { q: 'Ada', page: 1, pageSize: 25, sort: 'name', dir: 'asc' });
    const [q] = queries;
    assert.ok(q?.sql.includes('from "memberships" as "m" inner join "users" as "u"'));
    assert.ok(q?.sql.includes('from role_permissions rp where rp.role_id = "r"."id"'));
    assert.ok(
      q?.sql.includes(`(lower(u.first_name || ' ' || u.last_name) like $2 or "u"."email" like $3)`)
    );
    assert.ok(q?.sql.includes('order by (lower(u.last_name), lower(u.first_name)) asc nulls last'));
    assert.deepEqual(q?.parameters.slice(0, 3), ['t-1', '%ada%', '%ada%']);
    await db.destroy();
  });

  it('finds members and roles within the agency', async () => {
    const { db, queries } = createRecordingDb(() => []);
    assert.equal(await findMember(db, 't-1', 'u-1'), undefined);
    assert.equal(await findRolePermissions(db, 't-1', 'r-1'), undefined);
    assert.deepEqual(queries[0]?.parameters, ['t-1', 'u-1']);
    assert.ok(queries[1]?.sql.endsWith('where "r"."agency_id" = $1 and "r"."id" = $2'));
    await db.destroy();
  });

  it('changes roles by version, deletes members and checks remaining memberships', async () => {
    let rows: unknown[] = [{ id: 'm-1' }];
    const { db, queries } = createRecordingDb(() => rows);
    assert.deepEqual(await setMemberRole(db, 't-1', 'u-1', { roleId: 'r-2', version: 4 }), {
      id: 'm-1'
    });
    await deleteMember(db, 't-1', 'u-1');
    assert.equal(await hasMemberships(db, 'u-1'), true);
    rows = [];
    assert.equal(await hasMemberships(db, 'u-1'), false);
    const [set, del, has] = queries;
    assert.ok(set?.sql.includes('"version" = version + 1'));
    assert.ok(
      set?.sql.endsWith('"agency_id" = $2 and "user_id" = $3 and "version" = $4 returning "id"')
    );
    assert.deepEqual(set?.parameters, ['r-2', 't-1', 'u-1', 4]);
    assert.equal(
      del?.sql,
      'delete from "memberships" where "agency_id" = $1 and "user_id" = $2 returning "id"'
    );
    assert.equal(has?.sql, 'select "id" from "memberships" where "user_id" = $1 limit $2');
    await db.destroy();
  });

  it('replaces a user’s password tokens and drops expired ones, storing only the hash', async () => {
    const { db, queries } = createRecordingDb();
    const now = new Date('2026-01-01T00:00:00Z');
    await replacePasswordToken(db, { userId: 'u-1', hash: 'h', expiresAt: EXPIRES, now });
    const [cleared, inserted] = queries;
    assert.equal(
      cleared?.sql,
      'delete from "password_tokens" where ("user_id" = $1 or "expires_at" <= $2)'
    );
    assert.deepEqual(cleared?.parameters, ['u-1', now]);
    assert.deepEqual(inserted?.parameters, ['u-1', 'h', EXPIRES]);
    await db.destroy();
  });

  it('pairs each agency of a member with the caller’s role there, if any', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await findMemberRanks(db, 'u-2', 'u-1');
    const [q] = queries;
    assert.ok(
      q?.sql.includes(
        'from "memberships" as "t" left join "memberships" as "r" on "r"."agency_id" = "t"."agency_id" and "r"."user_id" = $1'
      )
    );
    assert.ok(
      q?.sql.includes('rp.role_id = "t"."role_id"') && q.sql.includes('rp.role_id = "r"."role_id"')
    );
    assert.deepEqual(q?.parameters, ['u-1', 'u-2']);
    await db.destroy();
  });

  it('lists every role of the agency by name', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await listGrantableRoles(db, 't-1');
    assert.ok(queries[0]?.sql.endsWith('where "r"."agency_id" = $1 order by lower(r.name)'));
    await db.destroy();
  });
});

describe('invitation queries', () => {
  it('searches, pages, finds and checks invitations within the agency', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await searchInvitations(db, 't-1', {
      q: 'Ada',
      page: 1,
      pageSize: 25,
      sort: 'expires',
      dir: 'asc'
    });
    await findInvitation(db, 't-1', 'i-1');
    assert.equal(await isMemberEmail(db, 't-1', 'a@example.com'), false);
    const [list, find, member] = queries;
    assert.ok(
      list?.sql.includes(
        `where "i"."agency_id" = $1 and (lower(i.first_name || ' ' || i.last_name) like $2 or "i"."email" like $3)`
      )
    );
    assert.ok(list?.sql.includes('order by "i"."expires_at" asc nulls last, "i"."id" asc'));
    assert.deepEqual(list?.parameters, ['t-1', '%ada%', '%ada%', 25, 0]);
    assert.ok(find?.sql.includes('rp.role_id = "i"."role_id"'));
    assert.deepEqual(find?.parameters, ['t-1', 'i-1']);
    assert.deepEqual(member?.parameters, ['t-1', 'a@example.com']);
    await db.destroy();
  });

  it('upserts one invitation per agency and email, renews and deletes it', async () => {
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
    await renewInvitation(db, 't-1', 'i-1', { hash: 'h2', expiresAt: EXPIRES });
    await deleteInvitation(db, 't-1', 'i-1');
    const [upsert, renew, del] = queries;
    assert.ok(upsert?.sql.includes('on conflict ("agency_id", "email") do update set'));
    assert.ok(upsert?.sql.includes('"token_hash" = $'));
    assert.deepEqual(renew?.parameters, ['h2', EXPIRES, 't-1', 'i-1']);
    assert.equal(
      del?.sql,
      'delete from "invitations" where "agency_id" = $1 and "id" = $2 returning "id"'
    );
    await db.destroy();
  });
});
