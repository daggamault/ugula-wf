import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as v from 'valibot';
import { facilitySchema, searchFacilitiesQuery } from './schemas.ts';

describe('facilitySchema', () => {
  it('accepts a named facility with an optional address and phone', () => {
    assert.deepEqual(
      v.parse(facilitySchema, {
        name: ' Sunrise SNF ',
        addressLine: ' 5 Elm St ',
        city: '',
        state: 'il',
        postalCode: '62702'
      }),
      {
        name: 'Sunrise SNF',
        addressLine: '5 Elm St',
        city: null,
        state: 'IL',
        postalCode: '62702',
        phone: null
      }
    );
  });

  it('rejects blank names, bad states and ZIP codes', () => {
    for (const bad of [
      { name: ' ' },
      { name: 'X', state: 'Illinois' },
      { name: 'X', postalCode: '627' }
    ]) {
      assert.equal(v.safeParse(facilitySchema, bad).success, false, JSON.stringify(bad));
    }
    assert.deepEqual(v.parse(searchFacilitiesQuery, {}), {
      page: 1,
      pageSize: 25,
      sort: 'name',
      dir: 'asc'
    });
  });
});
