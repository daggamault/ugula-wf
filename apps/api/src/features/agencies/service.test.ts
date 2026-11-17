import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PERMISSIONS } from '@ugula/access';
import { createRecordingDb } from '@ugula/db/testing';
import { createAgencyService } from './service.ts';

const ROW = {
  agency_id: 't-1',
  agency_name: 'Development',
  organization_id: 'o-1',
  organization_name: 'Development EMS',
  is_full: false,
  permissions: ['fees:read', 'not:a-permission']
};

describe('agency service', () => {
  it('lists the agencies a user can reach, ordered by organization then agency', async () => {
    const { db, queries } = createRecordingDb(() => [ROW]);
    assert.deepEqual(await createAgencyService({ db }).list('u-1'), [
      { id: 't-1', name: 'Development', organizationId: 'o-1', organizationName: 'Development EMS' }
    ]);
    assert.equal(queries.length, 1);
    assert.ok(queries[0]?.sql.endsWith('order by "o"."name", "a"."name"'));
    assert.equal(queries[0]?.parameters.includes('u-1'), true);
  });

  it('resolves a member’s access to the known permissions of their role', async () => {
    const { db, queries } = createRecordingDb(() => [ROW]);
    assert.deepEqual(await createAgencyService({ db }).access('u-1', 't-1'), {
      agencyId: 't-1',
      agencyName: 'Development',
      organizationId: 'o-1',
      organizationName: 'Development EMS',
      userId: 'u-1',
      isOrganizationAdmin: false,
      permissions: ['fees:read']
    });
    assert.equal(queries[0]?.parameters.at(-1), 't-1');
  });

  it('grants every permission to organization admins', async () => {
    const { db } = createRecordingDb(() => [{ ...ROW, is_full: true, permissions: [] }]);
    const access = await createAgencyService({ db }).access('u-1', 't-1');
    assert.equal(access?.isOrganizationAdmin, true);
    assert.deepEqual(access?.permissions, [...PERMISSIONS]);
  });

  it('has no access to an agency the user cannot reach', async () => {
    const { db } = createRecordingDb(() => []);
    assert.equal(await createAgencyService({ db }).access('u-1', 't-1'), null);
  });
});
