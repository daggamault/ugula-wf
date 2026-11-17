import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { USER_ADMIN_PERMISSIONS } from '@ugula/access';
import { createRecordingDb } from '@ugula/db/testing';
import { hasUserAdmin, lockMemberships } from './memberships.ts';

const ADMINS =
  'select exists (select "m"."id" from "memberships" as "m" inner join "users" as "u" on "u"."id" = "m"."user_id" where "m"."agency_id" = $1 and "u"."is_active" = $2 and coalesce((\n  select array_agg(rp.permission order by rp.permission)\n  from role_permissions rp where rp.role_id = "m"."role_id"\n), \'{}\') @> $3::text[]';

describe('lockMemberships', () => {
  it('locks the agency row so membership changes serialize', async () => {
    const { db, queries } = createRecordingDb();
    await lockMemberships(db, 't-1');
    assert.equal(queries[0]?.sql, 'select "id" from "agencies" where "id" = $1 for no key update');
    assert.deepEqual(queries[0]?.parameters, ['t-1']);
  });
});

describe('hasUserAdmin', () => {
  it('asks whether an active agency member holds every user permission', async () => {
    const { db, queries } = createRecordingDb(() => [{ found: true }]);
    assert.equal(await hasUserAdmin(db, 't-1', {}), true);
    assert.equal(queries[0]?.sql, `${ADMINS}) as "found"`);
    assert.deepEqual(queries[0]?.parameters, ['t-1', true, USER_ADMIN_PERMISSIONS]);
  });

  it('leaves out a role and a user about to lose their permissions', async () => {
    const { db, queries } = createRecordingDb(() => [{ found: false }]);
    assert.equal(await hasUserAdmin(db, 't-1', { roleId: 'r-1', userId: 'u-1' }), false);
    assert.equal(
      queries[0]?.sql,
      `${ADMINS} and "m"."role_id" != $4 and "m"."user_id" != $5) as "found"`
    );
    assert.deepEqual(queries[0]?.parameters, ['t-1', true, USER_ADMIN_PERMISSIONS, 'r-1', 'u-1']);
  });

  it('leaves out only a role or only a user', async () => {
    const { db, queries } = createRecordingDb(() => [{ found: true }]);
    await hasUserAdmin(db, 't-1', { roleId: 'r-1' });
    await hasUserAdmin(db, 't-1', { userId: 'u-1' });
    assert.ok(queries[0]?.sql.endsWith('@> $3::text[] and "m"."role_id" != $4) as "found"'));
    assert.ok(queries[1]?.sql.endsWith('@> $3::text[] and "m"."user_id" != $4) as "found"'));
    assert.deepEqual(queries[1]?.parameters, ['t-1', true, USER_ADMIN_PERMISSIONS, 'u-1']);
  });
});
