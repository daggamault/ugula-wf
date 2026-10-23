import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as v from 'valibot';
import { billingDataSchema, listClaimsQuery, payersSchema, responseSchema } from './schemas.ts';

describe('claim schemas', () => {
  it('defaults list filters to open claims', () => {
    assert.deepEqual(v.parse(listClaimsQuery, {}), {
      status: 'open',
      page: 1,
      pageSize: 25,
      sort: 'created',
      dir: 'desc'
    });
    assert.equal(v.safeParse(listClaimsQuery, { sort: 'balance', dir: 'asc' }).success, true);
    assert.equal(v.safeParse(listClaimsQuery, { sort: 'payer' }).success, false);
  });

  it('accepts ordered unique payers', () => {
    assert.deepEqual(v.parse(payersSchema, { payers: [' Medicare ', 'Blue Plan'] }), {
      payers: ['Medicare', 'Blue Plan']
    });
    assert.equal(v.safeParse(payersSchema, { payers: ['A', 'A'] }).success, false);
    assert.equal(v.safeParse(payersSchema, { payers: [' '] }).success, false);
  });

  it('treats a missing payer as a patient payment and rejects negative amounts', () => {
    const requestId = '01a16617-7704-7ba6-b9b5-9c79fa44f965';
    assert.deepEqual(v.parse(responseSchema, { requestId, paidCents: 500 }), {
      requestId,
      coverageId: null,
      paidCents: 500,
      adjustedCents: 0,
      note: ''
    });
    assert.equal(v.safeParse(responseSchema, { requestId, paidCents: -1 }).success, false);
    assert.equal(v.safeParse(responseSchema, { requestId, paidCents: 1.5 }).success, false);
    assert.equal(v.safeParse(responseSchema, { paidCents: 1 }).success, false);
    assert.equal(v.safeParse(responseSchema, { requestId, coverageId: 'Medicare' }).success, false);
  });

  it('normalizes billing data and turns blanks into missing values', () => {
    const requestId = '01a16617-7704-7ba6-b9b5-9c79fa44f965';
    assert.deepEqual(
      v.parse(billingDataSchema, {
        patient: { addressLine: ' 1 Main ', city: '', state: 'il', postalCode: '62704-1234' },
        coverages: [{ id: requestId, memberId: ' 1EG ', groupId: '' }],
        serviceDate: '2026-10-01',
        pickup: {
          name: '',
          addressLine: '9 Elm',
          city: 'Springfield',
          state: 'IL',
          postalCode: '62701'
        },
        destination: {},
        diagnoses: ['r07.9', 'I10', 'R07.9']
      }),
      {
        patient: { addressLine: '1 Main', city: null, state: 'IL', postalCode: '627041234' },
        coverages: [{ id: requestId, memberId: '1EG', groupId: null }],
        serviceDate: '2026-10-01',
        pickup: {
          name: null,
          addressLine: '9 Elm',
          city: 'Springfield',
          state: 'IL',
          postalCode: '62701'
        },
        destination: { name: null, addressLine: null, city: null, state: null, postalCode: null },
        diagnoses: ['R079', 'I10'],
        originDestination: null
      }
    );
    const fails = (over: Record<string, unknown>) =>
      !v.safeParse(billingDataSchema, {
        patient: {},
        coverages: [],
        serviceDate: null,
        pickup: {},
        destination: {},
        diagnoses: [],
        ...over
      }).success;
    assert.ok(fails({ patient: { state: 'Illinois' } }));
    assert.ok(fails({ patient: { postalCode: '6270' } }));
    assert.ok(fails({ originDestination: 'RZ' }));
    assert.ok(!fails({ originDestination: ' sh ' }));
    assert.ok(fails({ diagnoses: ['bad'] }));
    assert.ok(fails({ serviceDate: '10/01/2026' }));
    assert.ok(!fails({}));
  });
});
