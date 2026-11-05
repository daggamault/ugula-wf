import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { assignFacility, findFacilityName, listFacilityOptions } from './facility-queries.ts';

describe('facility queries', () => {
  it('lists the agency facilities by name, searching only when asked', async () => {
    const { db, queries } = createRecordingDb(() => []);
    assert.deepEqual(await listFacilityOptions(db, 't-1', undefined), []);
    await listFacilityOptions(db, 't-1', 'Mercy');
    const [all, search] = queries;
    assert.ok(all?.sql.endsWith('where "agency_id" = $1 order by lower(name), "id" limit $2'));
    assert.deepEqual(all?.parameters, ['t-1', 20]);
    assert.ok(search?.sql.includes('and lower(name) like $2'));
    assert.deepEqual(search?.parameters, ['t-1', '%mercy%', 20]);
    await db.destroy();
  });

  it('names a facility only within the agency', async () => {
    const { db, queries } = createRecordingDb(() => [{ name: 'Mercy' }]);
    assert.equal(await findFacilityName(db, 't-1', 'f1'), 'Mercy');
    assert.ok(queries[0]?.sql.endsWith('where "id" = $1 and "agency_id" = $2'));
    assert.deepEqual(queries[0]?.parameters, ['f1', 't-1']);
    await db.destroy();
  });

  it('bills a claim to a facility or back to the payers and logs who did it', async () => {
    const { db, queries } = createRecordingDb(() => []);
    const claim = { agencyId: 't-1', claimId: 'c1', userId: 'u1' };
    await assignFacility(db, claim, { id: 'f1', name: 'Mercy' });
    await assignFacility(db, claim, null);
    const [set, billed, clear, payers] = queries;
    assert.ok(set?.sql.startsWith('update "claims" set "facility_id" = $1'));
    assert.deepEqual(set?.parameters, ['f1', 'c1', 't-1']);
    assert.deepEqual(billed?.parameters, ['c1', 'responsibility', 'Billed to Mercy', 'u1']);
    assert.deepEqual(clear?.parameters, [null, 'c1', 't-1']);
    assert.deepEqual(payers?.parameters, ['c1', 'responsibility', 'Billed to the payers', 'u1']);
    await db.destroy();
  });
});
