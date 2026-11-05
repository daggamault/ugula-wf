import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import {
  deleteRole,
  findRole,
  insertRole,
  replacePermissions,
  searchRoles,
  updateRole
} from './queries.ts';

describe('role queries', () => {
  it('searches the agency’s roles by name with their permissions and user counts', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await searchRoles(db, 't-1', { q: 'Bill', page: 1, pageSize: 25, sort: 'users', dir: 'desc' });
    const [q] = queries;
    assert.ok(q?.sql.includes('from role_permissions rp where rp.role_id = "r"."id"'));
    assert.ok(
      q?.sql.includes('(select count(*)::int from memberships m where m.role_id = r.id) as "users"')
    );
    assert.ok(q?.sql.includes('"r"."agency_id" = $1 and lower(r.name) like $2'));
    assert.ok(
      q?.sql.includes(
        'order by (select count(*)::int from memberships m where m.role_id = r.id) desc nulls last'
      )
    );
    assert.deepEqual(q?.parameters.slice(0, 2), ['t-1', '%bill%']);
    await db.destroy();
  });

  it('finds, inserts, updates by version and deletes roles within the agency', async () => {
    const { db, queries } = createRecordingDb(() => [{ id: 'r-1' }]);
    await findRole(db, 't-1', 'r-1');
    assert.deepEqual(await insertRole(db, 't-1', 'Biller'), { id: 'r-1' });
    await updateRole(db, 't-1', 'r-1', { name: 'Biller', version: 3 });
    await deleteRole(db, 't-1', 'r-1');
    const [find, insert, update, del] = queries;
    assert.ok(find?.sql.endsWith('"r"."agency_id" = $1 and "r"."id" = $2'));
    assert.deepEqual(insert?.parameters, ['t-1', 'Biller']);
    assert.ok(update?.sql.includes('"version" = version + 1'));
    assert.ok(
      update?.sql.endsWith('where "id" = $2 and "agency_id" = $3 and "version" = $4 returning "id"')
    );
    assert.deepEqual(update?.parameters, ['Biller', 'r-1', 't-1', 3]);
    assert.equal(
      del?.sql,
      'delete from "roles" where "id" = $1 and "agency_id" = $2 returning "id"'
    );
    await db.destroy();
  });

  it('replaces permissions, skipping the insert when none remain', async () => {
    const { db, queries } = createRecordingDb();
    await replacePermissions(db, 'r-1', ['fees:read', 'fees:update']);
    await replacePermissions(db, 'r-1', []);
    assert.deepEqual(
      queries.map((q) => q.sql),
      [
        'delete from "role_permissions" where "role_id" = $1',
        'insert into "role_permissions" ("role_id", "permission") values ($1, $2), ($3, $4)',
        'delete from "role_permissions" where "role_id" = $1'
      ]
    );
    await db.destroy();
  });
});
