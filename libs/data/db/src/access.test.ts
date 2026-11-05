import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BUILT_IN_ROLES, PERMISSIONS } from '@ugula/access';
import {
  canOpenAgency,
  findAgencyAccess,
  listAccessibleAgencies,
  permissionsOf,
  rolePermissionsSql,
  saveBuiltInRoles
} from './access.ts';
import { createRecordingDb } from './testing.ts';

const row = {
  agency_id: 't-1',
  agency_name: 'Development',
  organization_id: 'o-1',
  organization_name: 'Development EMS',
  is_full: false,
  permissions: ['fees:read', 'nope']
};

describe('permissionsOf and rolePermissionsSql', () => {
  it('keeps only known permissions of a role, sorted, or none', async () => {
    assert.deepEqual(permissionsOf({ permissions: ['fees:read', 'nope', 'users:read'] }), [
      'fees:read',
      'users:read'
    ]);
    const { db, queries } = createRecordingDb();
    await db.selectFrom('roles as r').select(rolePermissionsSql('r.id').as('p')).execute();
    assert.ok(
      queries[0]?.sql.includes(
        'coalesce((\n  select array_agg(rp.permission order by rp.permission)\n  from role_permissions rp where rp.role_id = "r"."id"\n), \'{}\')'
      )
    );
    await db.destroy();
  });
});

describe('findAgencyAccess', () => {
  it('grants members the permissions of their role', async () => {
    const { db, queries } = createRecordingDb(() => [row]);
    assert.deepEqual(await findAgencyAccess(db, 'u-1', 't-1'), {
      agencyId: 't-1',
      agencyName: 'Development',
      organizationId: 'o-1',
      organizationName: 'Development EMS',
      userId: 'u-1',
      isOrganizationAdmin: false,
      permissions: ['fees:read']
    });
    const sql = queries[0]?.sql ?? '';
    for (const part of [
      '("u"."type" = $1 or "a"."organization_id" = "u"."organization_id")',
      "u.type = 'platform' or u.is_owner",
      'rp.role_id = "m"."role_id"',
      '"u"."is_active" = $',
      '"a"."is_active" = $',
      '"o"."is_active" = $',
      '"m"."id" is not null'
    ]) {
      assert.ok(sql.includes(part), part);
    }
    assert.deepEqual(queries[0]?.parameters, [
      'platform',
      'u-1',
      true,
      true,
      true,
      'platform',
      true,
      't-1'
    ]);
    await db.destroy();
  });

  it('grants platform users and organization owners every permission', async () => {
    const { db } = createRecordingDb(() => [{ ...row, is_full: true, permissions: [] }]);
    const access = await findAgencyAccess(db, 'u-1', 't-1');
    assert.equal(access?.isOrganizationAdmin, true);
    assert.deepEqual(access?.permissions, [...PERMISSIONS]);
    await db.destroy();
  });

  it('finds no access outside the user’s agencies', async () => {
    const { db } = createRecordingDb(() => []);
    assert.equal(await findAgencyAccess(db, 'u-1', 't-2'), null);
    await db.destroy();
  });
});

describe('listAccessibleAgencies and canOpenAgency', () => {
  it('lists the agencies a user can reach ordered by organization and agency name', async () => {
    const { db, queries } = createRecordingDb(() => [row]);
    assert.deepEqual(await listAccessibleAgencies(db, 'u-1'), [
      { id: 't-1', name: 'Development', organizationId: 'o-1', organizationName: 'Development EMS' }
    ]);
    assert.ok(queries[0]?.sql.endsWith('order by "o"."name", "a"."name"'));
    await db.destroy();
  });

  it('opens an agency only through the same reach as access', async () => {
    let rows: unknown[] = [{ id: 't-1' }];
    const { db, queries } = createRecordingDb(() => rows);
    assert.equal(await canOpenAgency(db, 'u-1', 't-1'), true);
    assert.ok(queries[0]?.sql.startsWith('select "a"."id" from "users" as "u"'));
    assert.ok(queries[0]?.sql.includes('"m"."id" is not null'));
    assert.deepEqual(queries[0]?.parameters.slice(-1), ['t-1']);
    rows = [];
    assert.equal(await canOpenAgency(db, 'u-1', 't-1'), false);
    await db.destroy();
  });
});

describe('saveBuiltInRoles', () => {
  it('creates or resets every built-in role of an agency in three statements', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('insert into "roles"')
        ? BUILT_IN_ROLES.map((r, i) => ({ id: `r-${i}`, name: r.name }))
        : []
    );
    const ids = await saveBuiltInRoles(db, 't-1');
    assert.deepEqual(
      [...ids],
      BUILT_IN_ROLES.map((r, i) => [r.name, `r-${i}`])
    );
    const [roles, cleared, granted] = queries;
    assert.ok(roles?.sql.includes('on conflict ("agency_id", "name") do update'));
    assert.deepEqual(
      roles?.parameters,
      BUILT_IN_ROLES.flatMap((r) => ['t-1', r.name])
    );
    assert.ok(cleared?.sql.startsWith('delete from "role_permissions" where "role_id" in'));
    assert.equal(
      granted?.parameters.length,
      BUILT_IN_ROLES.reduce((n, r) => n + r.permissions.length * 2, 0)
    );
    assert.equal(queries.length, 3);
    await db.destroy();
  });
});
