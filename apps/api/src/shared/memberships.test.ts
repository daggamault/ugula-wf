import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { USER_ADMIN_PERMISSIONS } from '@ugula/access';
import { createRecordingDb } from '@ugula/db/testing';
import { hasUserAdmin, lockMemberships } from './memberships.ts';

describe('lockMemberships', () => {
  it('locks the agency row so membership changes serialize', async () => {
    const { db, queries } = createRecordingDb();
    await lockMemberships(db, 't-1');
    assert.equal(queries[0]?.sql, 'select "id" from "agencies" where "id" = $1 for no key update');
    assert.deepEqual(queries[0]?.parameters, ['t-1']);
    await db.destroy();
  });
});

describe('hasUserAdmin', () => {
  it('asks the database whether another active member holds every user permission', async () => {
    let found = true;
    const { db, queries } = createRecordingDb(() => [{ found }]);
    assert.equal(await hasUserAdmin(db, 't-1', { roleId: 'r-1', userId: 'u-1' }), true);
    const [q] = queries;
    assert.ok(q?.sql.startsWith('select exists (select "m"."id" from "memberships" as "m"'));
    assert.ok(q?.sql.includes('inner join "users" as "u" on "u"."id" = "m"."user_id"'));
    assert.ok(q?.sql.includes('"u"."is_active" = $2'));
    assert.ok(q?.sql.includes('rp.role_id = "m"."role_id"'));
    assert.ok(q?.sql.includes(') @> $3::text[] and "m"."role_id" != $4 and "m"."user_id" != $5'));
    assert.deepEqual(q?.parameters, ['t-1', true, USER_ADMIN_PERMISSIONS, 'r-1', 'u-1']);
    found = false;
    assert.equal(await hasUserAdmin(db, 't-1', {}), false);
    assert.deepEqual(queries[1]?.parameters, ['t-1', true, USER_ADMIN_PERMISSIONS]);
    await db.destroy();
  });
});
