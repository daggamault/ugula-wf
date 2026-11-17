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

const PAGE = { page: 1, pageSize: 25, sort: 'name', dir: 'asc' } as const;

const ROW = {
  id: 'r-1',
  name: 'Biller',
  version: 1,
  updated_at: 'now',
  permissions: ['fees:read'],
  users: 2
};

const MEMBERS = '(select count(*)::int from memberships m where m.role_id = r.id)';

describe('role queries', () => {
  it('pages the agency’s roles with their permissions and user counts by name', async () => {
    const { db, queries } = createRecordingDb(() => [{ ...ROW, total: '1' }]);
    assert.deepEqual(await searchRoles(db, 't-1', PAGE), {
      items: [ROW],
      total: 1,
      page: 1,
      pageSize: 25
    });
    assert.equal(
      queries[0]?.sql,
      `select "r"."id", "r"."name", "r"."version", "r"."updated_at", coalesce((\n  select array_agg(rp.permission order by rp.permission)\n  from role_permissions rp where rp.role_id = "r"."id"\n), '{}') as "permissions", (select count(*)::int from memberships m where m.role_id = r.id) as "users", count(*) over () as "total" from "roles" as "r" where "r"."agency_id" = $1 order by lower(r.name) asc nulls last, "r"."id" asc limit $2 offset $3`
    );
    assert.deepEqual(queries[0]?.parameters, ['t-1', 25, 0]);
  });

  it('searches role names and sorts by user count', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await searchRoles(db, 't-1', { ...PAGE, q: ' Bill ', sort: 'users', dir: 'desc' });
    assert.ok(
      queries[0]?.sql.endsWith(
        `where "r"."agency_id" = $1 and lower(r.name) like $2 order by ${MEMBERS} desc nulls last, "r"."id" desc limit $3 offset $4`
      )
    );
    assert.deepEqual(queries[0]?.parameters, ['t-1', '%bill%', 25, 0]);
  });

  it('sorts by when the role last changed', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await searchRoles(db, 't-1', { ...PAGE, sort: 'updated' });
    assert.ok(
      queries[0]?.sql.endsWith(
        'order by "r"."updated_at" asc nulls last, "r"."id" asc limit $2 offset $3'
      )
    );
  });

  it('finds a role within the agency', async () => {
    const { db, queries } = createRecordingDb(() => [ROW]);
    assert.deepEqual(await findRole(db, 't-1', 'r-1'), ROW);
    assert.ok(
      queries[0]?.sql.endsWith('from "roles" as "r" where "r"."agency_id" = $1 and "r"."id" = $2')
    );
    assert.deepEqual(queries[0]?.parameters, ['t-1', 'r-1']);
  });

  it('inserts a role into the agency', async () => {
    const { db, queries } = createRecordingDb(() => [{ id: 'r-1' }]);
    assert.deepEqual(await insertRole(db, 't-1', 'Biller'), { id: 'r-1' });
    assert.equal(
      queries[0]?.sql,
      'insert into "roles" ("agency_id", "name") values ($1, $2) returning "id"'
    );
    assert.deepEqual(queries[0]?.parameters, ['t-1', 'Biller']);
  });

  it('renames a role at the expected version within the agency and bumps the version', async () => {
    const { db, queries } = createRecordingDb(() => [{ id: 'r-1' }]);
    assert.deepEqual(await updateRole(db, 't-1', 'r-1', { name: 'Biller', version: 3 }), {
      id: 'r-1'
    });
    assert.equal(
      queries[0]?.sql,
      'update "roles" set "name" = $1, "version" = version + 1, "updated_at" = now() where "id" = $2 and "agency_id" = $3 and "version" = $4 returning "id"'
    );
    assert.deepEqual(queries[0]?.parameters, ['Biller', 'r-1', 't-1', 3]);
  });

  it('updates nothing at a stale version', async () => {
    const { db } = createRecordingDb(() => []);
    assert.equal(await updateRole(db, 't-1', 'r-1', { name: 'Biller', version: 2 }), undefined);
  });

  it('deletes a role only within the agency', async () => {
    const { db, queries } = createRecordingDb(() => [{ id: 'r-1' }]);
    assert.deepEqual(await deleteRole(db, 't-1', 'r-1'), { id: 'r-1' });
    assert.equal(
      queries[0]?.sql,
      'delete from "roles" where "id" = $1 and "agency_id" = $2 returning "id"'
    );
    assert.deepEqual(queries[0]?.parameters, ['r-1', 't-1']);
    assert.equal(await deleteRole(createRecordingDb(() => []).db, 't-1', 'r-1'), undefined);
  });

  it('replaces a role’s permissions', async () => {
    const { db, queries } = createRecordingDb();
    await replacePermissions(db, 'r-1', ['fees:read', 'fees:update']);
    assert.deepEqual(
      queries.map((q) => [q.sql, q.parameters]),
      [
        ['delete from "role_permissions" where "role_id" = $1', ['r-1']],
        [
          'insert into "role_permissions" ("role_id", "permission") values ($1, $2), ($3, $4)',
          ['r-1', 'fees:read', 'r-1', 'fees:update']
        ]
      ]
    );
  });

  it('only clears permissions when none remain', async () => {
    const { db, queries } = createRecordingDb();
    await replacePermissions(db, 'r-1', []);
    assert.deepEqual(
      queries.map((q) => q.sql),
      ['delete from "role_permissions" where "role_id" = $1']
    );
  });
});
