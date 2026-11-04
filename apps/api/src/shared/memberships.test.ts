import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { USER_ADMIN_PERMISSIONS } from '@ugula/access';
import { createRecordingDb } from '@ugula/db/testing';
import { hasUserAdmin, lockMemberships, permissionsOf } from './memberships.ts';

describe('permissionsOf', () => {
  it('keeps only known permissions', () => {
    assert.deepEqual(permissionsOf({ permissions: ['fees:read', 'nope', 'users:read'] }), [
      'fees:read',
      'users:read'
    ]);
  });
});

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
  it('looks for another member holding every user permission', async () => {
    let rows = [{ permissions: ['fees:read'] }, { permissions: [...USER_ADMIN_PERMISSIONS] }];
    const { db, queries } = createRecordingDb(() => rows);
    assert.equal(await hasUserAdmin(db, 't-1', { roleId: 'r-1', userId: 'u-1' }), true);
    const [q] = queries;
    assert.ok(q?.sql.includes('from role_permissions rp where rp.role_id = "m"."role_id"'));
    assert.ok(
      q?.sql.includes('"m"."agency_id" = $1 and "m"."role_id" != $2 and "m"."user_id" != $3')
    );
    assert.deepEqual(q?.parameters, ['t-1', 'r-1', 'u-1']);
    rows = [{ permissions: ['users:read', 'users:create'] }];
    assert.equal(await hasUserAdmin(db, 't-1', {}), false);
    assert.deepEqual(queries[1]?.parameters, ['t-1']);
    await db.destroy();
  });
});
