import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { icd10, readClaimDetails, readCoverages } from './claim-details.ts';

describe('readClaimDetails', () => {
  it('takes the service date, locations and X12-ready diagnosis codes from a summary', () => {
    assert.deepEqual(
      readClaimDetails({
        incidentAt: '2026-10-01T08:15:00-05:00',
        primaryImpression: 'R07.9',
        secondaryImpressions: ['I10', 'e11.9', 'R07.9', 'not a code'],
        pickup: { addressLine: '9 Elm St', city: '2395220', state: '17', postalCode: '62704' },
        destination: {
          name: 'St. Mary',
          addressLine: '1 Hospital Way',
          city: 'Springfield',
          state: 'IL',
          postalCode: '62701'
        }
      }),
      {
        serviceDate: '2026-10-01',
        pickup: {
          name: null,
          addressLine: '9 Elm St',
          city: null,
          state: 'IL',
          postalCode: '62704'
        },
        destination: {
          name: 'St. Mary',
          addressLine: '1 Hospital Way',
          city: 'Springfield',
          state: 'IL',
          postalCode: '62701'
        },
        diagnoses: ['R079', 'I10', 'E119'],
        originDestination: null
      }
    );
    assert.deepEqual(readClaimDetails(null).diagnoses, []);
    assert.equal(icd10('S72.001A'), 'S72001A');
    assert.equal(icd10('12345'), null);
  });
});

describe('readCoverages', () => {
  it('orders coverages by NEMSIS billing priority, keeps directory links and drops duplicates', () => {
    assert.deepEqual(
      readCoverages({
        coverages: [
          { payer: 'Blue Plan', payerId: 'p-blue', priority: '2611005', memberId: 'B1' },
          { payer: 'Medicare', priority: '2611003', memberId: '1EG4TE5MK72', payerCode: 'MCR' },
          { payer: 'medicare', priority: '2611007' },
          { payer: null, priority: '2611009' }
        ]
      }),
      [
        {
          payer: 'Medicare',
          payerId: null,
          payerCode: 'MCR',
          memberId: '1EG4TE5MK72',
          groupId: null
        },
        { payer: 'Blue Plan', payerId: 'p-blue', payerCode: null, memberId: 'B1', groupId: null }
      ]
    );
  });

  it('falls back to the primary payer named by the payment method', () => {
    assert.deepEqual(readCoverages({ coverages: [], payer: 'Medicaid' }), [
      { payer: 'Medicaid', payerId: null, payerCode: null, memberId: null, groupId: null }
    ]);
    assert.deepEqual(readCoverages({}), []);
  });
});
