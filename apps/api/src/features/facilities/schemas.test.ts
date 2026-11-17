import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as v from 'valibot';
import { facilitySchema, searchFacilitiesQuery, searchHospitalsQuery } from './schemas.ts';

const issues = (input: unknown) => v.safeParse(facilitySchema, input).issues?.map((i) => i.message);

describe('facilitySchema', () => {
  it('trims a named facility, uppercases the state and defaults the rest', () => {
    assert.deepEqual(
      v.parse(facilitySchema, {
        name: ' Sunrise SNF ',
        addressLine: ' 5 Elm St ',
        city: '',
        state: ' il ',
        postalCode: ' 62702 '
      }),
      {
        name: 'Sunrise SNF',
        addressLine: '5 Elm St',
        city: null,
        state: 'IL',
        postalCode: '62702',
        phone: null,
        kind: 'other',
        hasContract: false,
        contractNote: null
      }
    );
  });

  it('keeps a kind, a contract and its note, and a ZIP+4', () => {
    assert.deepEqual(
      v.parse(facilitySchema, {
        name: 'Oak Manor',
        addressLine: null,
        city: ' Springfield ',
        state: null,
        postalCode: '627021234',
        phone: ' 2175550100 ',
        kind: 'snf',
        hasContract: true,
        contractNote: ' Pays discharges '
      }),
      {
        name: 'Oak Manor',
        addressLine: null,
        city: 'Springfield',
        state: null,
        postalCode: '627021234',
        phone: '2175550100',
        kind: 'snf',
        hasContract: true,
        contractNote: 'Pays discharges'
      }
    );
  });

  it('rejects blank and long names', () => {
    assert.deepEqual(issues({ name: ' ' }), ['Invalid length: Expected !0 but received 0']);
    assert.deepEqual(issues({ name: 'x'.repeat(81) }), [
      'Invalid length: Expected <=80 but received 81'
    ]);
  });

  it('rejects text longer than its field after trimming', () => {
    assert.deepEqual(issues({ name: 'X', addressLine: ` ${'x'.repeat(55)} ` }), undefined);
    assert.deepEqual(issues({ name: 'X', addressLine: 'x'.repeat(56) }), [
      'Invalid length: Expected <=55 but received 56'
    ]);
    assert.deepEqual(issues({ name: 'X', city: 'x'.repeat(31) }), [
      'Invalid length: Expected <=30 but received 31'
    ]);
    assert.deepEqual(issues({ name: 'X', phone: 'x'.repeat(21) }), [
      'Invalid length: Expected <=20 but received 21'
    ]);
    assert.deepEqual(issues({ name: 'X', contractNote: 'x'.repeat(501) }), [
      'Invalid length: Expected <=500 but received 501'
    ]);
  });

  it('rejects bad states, ZIP codes and kinds', () => {
    assert.deepEqual(issues({ name: 'X', state: 'Illinois' }), [
      'Invalid format: Expected /^[A-Z]{2}$/ but received "ILLINOIS"'
    ]);
    assert.deepEqual(issues({ name: 'X', postalCode: '627' }), ['Use a 5 or 9 digit ZIP code']);
    assert.deepEqual(issues({ name: 'X', kind: 'spa' }), [
      'Invalid type: Expected ("hospital" | "snf" | "dialysis" | "other") but received "spa"'
    ]);
  });
});

describe('facility search queries', () => {
  it('pages facilities by name ascending by default', () => {
    assert.deepEqual(v.parse(searchFacilitiesQuery, {}), {
      page: 1,
      pageSize: 25,
      sort: 'name',
      dir: 'asc'
    });
  });

  it('sorts facilities by city with trimmed search text', () => {
    assert.deepEqual(
      v.parse(searchFacilitiesQuery, { q: ' oak ', sort: 'city', dir: 'desc', page: '2' }),
      { q: 'oak', page: 2, pageSize: 25, sort: 'city', dir: 'desc' }
    );
    assert.equal(v.safeParse(searchFacilitiesQuery, { sort: 'state' }).success, false);
  });

  it('searches hospitals by trimmed text only', () => {
    assert.deepEqual(v.parse(searchHospitalsQuery, { q: ' mercy ' }), { q: 'mercy' });
    assert.deepEqual(v.parse(searchHospitalsQuery, {}), {});
  });
});
