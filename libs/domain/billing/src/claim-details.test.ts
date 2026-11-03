import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readClaimDetails, readCoverages, relationshipOf } from './claim-details.ts';
import { readDocumentation } from './documentation.ts';

describe('readClaimDetails', () => {
  it('takes the service date, locations and X12-ready diagnosis codes from a claim', () => {
    assert.deepEqual(
      readClaimDetails({
        serviceDate: '2026-10-01T08:15:00-05:00',
        diagnoses: ['R07.9', 'I10', 'e11.9', 'R07.9', 'not a code', '12345', 'S72.001A'],
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
        diagnoses: ['R079', 'I10', 'E119', 'S72001A'],
        originDestination: null,
        documentation: readDocumentation(null)
      }
    );
    assert.deepEqual(readClaimDetails(null).diagnoses, []);
  });
});

describe('readCoverages', () => {
  it('orders coverages by NEMSIS billing priority, keeps directory links, second plans and unnamed insurances, and drops duplicates', () => {
    assert.deepEqual(
      readCoverages([
        {
          payer: 'Blue Plan',
          payerId: 'p-blue',
          priority: '2611005',
          memberId: 'B1',
          relationship: '2622003',
          insuredFirstName: 'Pat',
          insuredLastName: 'Doe'
        },
        { payer: 'Medicare', priority: '2611003', memberId: '1EG4TE5MK72', payerCode: 'MCR' },
        { payer: 'medicare', priority: '2611007', memberId: '1eg4te5mk72' },
        { payer: 'Blue Plan', priority: '2611011', memberId: 'B2' },
        { payer: null, priority: '2611013', memberId: 'U9' },
        { payer: null, priority: '2611009' }
      ]),
      [
        {
          payer: 'Medicare',
          payerId: null,
          payerCode: 'MCR',
          memberId: '1EG4TE5MK72',
          groupId: null,
          relationship: '18',
          insuredFirstName: null,
          insuredLastName: null
        },
        {
          payer: 'Blue Plan',
          payerId: 'p-blue',
          payerCode: null,
          memberId: 'B1',
          groupId: null,
          relationship: '01',
          insuredFirstName: 'Pat',
          insuredLastName: 'Doe'
        },
        {
          payer: 'Blue Plan',
          payerId: null,
          payerCode: null,
          memberId: 'B2',
          groupId: null,
          relationship: '18',
          insuredFirstName: null,
          insuredLastName: null
        },
        {
          payer: 'Unnamed insurance, member U9',
          payerId: null,
          payerCode: null,
          memberId: 'U9',
          groupId: null,
          relationship: '18',
          insuredFirstName: null,
          insuredLastName: null
        }
      ]
    );
  });

  it('reads X12 or NEMSIS relationships, assuming self when none is reported', () => {
    assert.deepEqual(
      [null, '2622001', '2622005', '19', 'g8', '2622017', 'nope'].map(relationshipOf),
      ['18', '18', '19', '19', 'G8', '21', '21']
    );
  });

  it('reads nothing from a missing list', () => {
    assert.deepEqual(readCoverages(null), []);
  });
});
