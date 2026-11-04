import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PERMISSIONS } from '@ugula/access';
import { createRecordingDb } from '@ugula/db/testing';
import { findAgencyAccess, listAccessibleAgencies } from './queries.ts';

const row = {
  agency_id: 't-1',
  agency_name: 'Development',
  organization_id: 'o-1',
  organization_name: 'Development EMS',
  is_full: false,
  permissions: ['fees:read', 'nope'] as string[] | null
};

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
    const [q] = queries;
    assert.ok(
      q?.sql.includes('("u"."type" = $1 or "a"."organization_id" = "u"."organization_id")')
    );
    assert.ok(q?.sql.includes(`u.type = 'platform' or u.is_owner`));
    assert.ok(q?.sql.includes('"m"."id" is not null'));
    assert.deepEqual(q?.parameters, ['platform', 'u-1', true, true, true, 'platform', true, 't-1']);
    await db.destroy();
  });

  it('grants platform users and organization owners every permission', async () => {
    const { db } = createRecordingDb(() => [{ ...row, is_full: true, permissions: null }]);
    const access = await findAgencyAccess(db, 'u-1', 't-1');
    assert.equal(access?.isOrganizationAdmin, true);
    assert.deepEqual(access?.permissions, [...PERMISSIONS]);
    await db.destroy();
  });

  it('treats a member whose role has no permissions as holding none', async () => {
    const { db } = createRecordingDb(() => [{ ...row, permissions: null }]);
    assert.deepEqual((await findAgencyAccess(db, 'u-1', 't-1'))?.permissions, []);
    await db.destroy();
  });

  it('finds no access outside the user’s agencies', async () => {
    const { db } = createRecordingDb(() => []);
    assert.equal(await findAgencyAccess(db, 'u-1', 't-2'), null);
    await db.destroy();
  });
});

describe('listAccessibleAgencies', () => {
  it('lists the agencies a user can reach ordered by organization and agency name', async () => {
    const { db, queries } = createRecordingDb(() => [row]);
    assert.deepEqual(await listAccessibleAgencies(db, 'u-1'), [
      { id: 't-1', name: 'Development', organizationId: 'o-1', organizationName: 'Development EMS' }
    ]);
    assert.ok(queries[0]?.sql.endsWith('order by "o"."name", "a"."name"'));
    await db.destroy();
  });
});
