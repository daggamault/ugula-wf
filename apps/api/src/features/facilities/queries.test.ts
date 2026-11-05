import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import {
  deleteFacility,
  findFacility,
  insertFacility,
  searchFacilities,
  updateFacility
} from './queries.ts';

const input = {
  name: 'Sunrise SNF',
  addressLine: null,
  city: 'Springfield',
  state: 'IL',
  postalCode: null,
  phone: null
};

describe('facility queries', () => {
  it('scopes every query to the agency and totals what each facility owes', async () => {
    const { db, queries } = createRecordingDb(({ sql }) =>
      sql.startsWith('select') ? [{ id: 'f1', total: '1' }] : [{ id: 'f1' }]
    );
    await searchFacilities(db, 't-1', {
      q: 'sun',
      page: 1,
      pageSize: 25,
      sort: 'name',
      dir: 'asc'
    });
    await findFacility(db, 't-1', 'f1');
    assert.deepEqual(await insertFacility(db, 't-1', input), { id: 'f1' });
    assert.deepEqual(await updateFacility(db, 't-1', 'f1', input), { id: 'f1' });
    assert.equal(await deleteFacility(db, 't-1', 'f1'), true);
    assert.ok(queries.every((q) => q.parameters.includes('t-1')));
    assert.ok(queries[0]?.sql.includes('sum(b.balance_cents)'));
    assert.ok(queries[0]?.parameters.includes('%sun%'));
    assert.ok(queries[2]?.sql.includes('on conflict (agency_id, lower(name)) do nothing'));
  });
});
