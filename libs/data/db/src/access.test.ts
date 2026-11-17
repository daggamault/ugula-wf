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

const rolePermissions = (role: string) =>
  `coalesce((\n  select array_agg(rp.permission order by rp.permission)\n  from role_permissions rp where rp.role_id = ${role}\n), '{}')`;

const reach =
  'from "users" as "u" inner join "agencies" as "a" on ("u"."type" = $1 or "a"."organization_id" = "u"."organization_id") inner join "organizations" as "o" on "o"."id" = "a"."organization_id" left join "memberships" as "m" on "m"."agency_id" = "a"."id" and "m"."user_id" = "u"."id" where "u"."id" = $2 and "u"."is_active" = $3 and "a"."is_active" = $4 and "o"."is_active" = $5 and ("u"."type" = $6 or "u"."is_owner" = $7 or "m"."id" is not null)';

const reachParameters = ['platform', 'u-1', true, true, true, 'platform', true];

const accessColumns = `select "a"."id" as "agency_id", "a"."name" as "agency_name", "o"."id" as "organization_id", "o"."name" as "organization_name", u.type = 'platform' or u.is_owner as "is_full", ${rolePermissions('"m"."role_id"')} as "permissions"`;

const permissionsOfRole = (name: string) =>
  BUILT_IN_ROLES.find((r) => r.name === name)?.permissions ?? [];

describe('permissionsOf and rolePermissionsSql', () => {
  it('keeps only known permissions of a role', () => {
    assert.deepEqual(permissionsOf({ permissions: ['fees:read', 'nope', 'users:read'] }), [
      'fees:read',
      'users:read'
    ]);
    assert.deepEqual(permissionsOf({ permissions: [] }), []);
  });

  it('aggregates the permissions of a role sorted, or none', async () => {
    const { db, queries } = createRecordingDb();
    await db.selectFrom('roles as r').select(rolePermissionsSql('r.id').as('p')).execute();
    assert.equal(
      queries[0]?.sql,
      `select ${rolePermissions('"r"."id"')} as "p" from "roles" as "r"`
    );
    await db.destroy();
  });
});

describe('findAgencyAccess', () => {
  it('grants members the permissions of their role in an active agency they reach', async () => {
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
    assert.equal(queries[0]?.sql, `${accessColumns} ${reach} and "a"."id" = $8`);
    assert.deepEqual(queries[0]?.parameters, [...reachParameters, 't-1']);
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
    const { db, queries } = createRecordingDb(() => [
      row,
      { ...row, agency_id: 't-2', agency_name: 'North' }
    ]);
    assert.deepEqual(await listAccessibleAgencies(db, 'u-1'), [
      {
        id: 't-1',
        name: 'Development',
        organizationId: 'o-1',
        organizationName: 'Development EMS'
      },
      { id: 't-2', name: 'North', organizationId: 'o-1', organizationName: 'Development EMS' }
    ]);
    assert.equal(queries[0]?.sql, `${accessColumns} ${reach} order by "o"."name", "a"."name"`);
    assert.deepEqual(queries[0]?.parameters, reachParameters);
    await db.destroy();
  });

  it('opens an agency only through the same reach as access', async () => {
    let rows: unknown[] = [{ id: 't-1' }];
    const { db, queries } = createRecordingDb(() => rows);
    assert.equal(await canOpenAgency(db, 'u-1', 't-1'), true);
    assert.equal(queries[0]?.sql, `select "a"."id" ${reach} and "a"."id" = $8`);
    assert.deepEqual(queries[0]?.parameters, [...reachParameters, 't-1']);
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
    assert.equal(queries.length, 3);
    const [roles, cleared, granted] = queries;
    assert.equal(
      roles?.sql,
      'insert into "roles" ("agency_id", "name") values ($1, $2), ($3, $4), ($5, $6), ($7, $8) on conflict ("agency_id", "name") do update set "updated_at" = now() returning "id", "name"'
    );
    assert.deepEqual(roles?.parameters, [
      't-1',
      'Admin',
      't-1',
      'Billing Manager',
      't-1',
      'Biller',
      't-1',
      'Viewer'
    ]);
    assert.equal(
      cleared?.sql,
      'delete from "role_permissions" where "role_id" in ($1, $2, $3, $4)'
    );
    assert.deepEqual(cleared?.parameters, ['r-0', 'r-1', 'r-2', 'r-3']);
    assert.deepEqual(
      granted?.parameters,
      BUILT_IN_ROLES.flatMap((r, i) => r.permissions.flatMap((p) => [`r-${i}`, p]))
    );
    await db.destroy();
  });

  it('grants nothing to a stored role that is no longer built in', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('insert into "roles"')
        ? [
            { id: 'r-0', name: 'Viewer' },
            { id: 'r-9', name: 'Legacy' }
          ]
        : []
    );
    assert.deepEqual(
      [...(await saveBuiltInRoles(db, 't-1'))],
      [
        ['Viewer', 'r-0'],
        ['Legacy', 'r-9']
      ]
    );
    assert.deepEqual(queries[1]?.parameters, ['r-0', 'r-9']);
    assert.deepEqual(
      queries[2]?.parameters,
      permissionsOfRole('Viewer').flatMap((p) => ['r-0', p])
    );
    await db.destroy();
  });
});
