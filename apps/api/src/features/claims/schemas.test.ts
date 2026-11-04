import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as v from 'valibot';
import {
  billingDataSchema,
  claimEventsQuery,
  listClaimsQuery,
  payersSchema,
  responseSchema
} from './schemas.ts';

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
    assert.deepEqual(
      v.parse(listClaimsQuery, { status: 'all', lastName: ' smith ' }).lastName,
      'smith'
    );
    assert.equal(v.safeParse(listClaimsQuery, { status: 'needs_review' }).success, false);
    assert.equal(v.safeParse(listClaimsQuery, { status: 'pending' }).success, false);
    assert.equal(v.safeParse(listClaimsQuery, { birthDate: '01/02/1980' }).success, false);
    assert.equal(v.parse(listClaimsQuery, { number: ' 42 ' }).number, '42');
    assert.equal(v.safeParse(listClaimsQuery, { patientId: 'x' }).success, false);
    assert.equal(v.parse(listClaimsQuery, { sort: 'waiting' }).sort, 'waiting');
  });

  it('accepts ordered unique payers', () => {
    const self = { relationship: '18', insuredFirstName: null, insuredLastName: null };
    assert.deepEqual(
      v.parse(payersSchema, {
        payers: [
          ' Medicare ',
          { name: 'Blue Plan', relationship: '01', insuredFirstName: ' Sam ', insuredLastName: '' }
        ]
      }),
      {
        payers: [
          { name: 'Medicare', ...self },
          { name: 'Blue Plan', relationship: '01', insuredFirstName: 'Sam', insuredLastName: null }
        ]
      }
    );
    assert.equal(v.safeParse(payersSchema, { payers: ['A', 'A'] }).success, false);
    assert.equal(v.safeParse(payersSchema, { payers: ['A', { name: 'a' }] }).success, false);
    assert.equal(
      v.safeParse(payersSchema, { payers: [{ name: 'A', relationship: 'XX' }] }).success,
      false
    );
    assert.equal(v.safeParse(payersSchema, { payers: [' '] }).success, false);
    assert.equal(v.safeParse(payersSchema, { payers: ['x'.repeat(61)] }).success, false);
  });

  it('treats a missing payer as a patient payment and rejects negative amounts', () => {
    const requestId = '01a16617-7704-7ba6-b9b5-9c79fa44f965';
    assert.deepEqual(v.parse(responseSchema, { requestId, paidCents: 500 }), {
      requestId,
      kind: 'response',
      coverageId: null,
      paidCents: 500,
      adjustedCents: 0,
      paidOn: null,
      checkNumber: null,
      payerClaimNumber: null,
      adjustments: [],
      note: ''
    });
    assert.equal(
      v.parse(responseSchema, { requestId, payerClaimNumber: ' ICN-9 ' }).payerClaimNumber,
      'ICN-9'
    );
    assert.equal(v.safeParse(responseSchema, { requestId, paidCents: -1 }).success, false);
    assert.equal(v.safeParse(responseSchema, { requestId, paidCents: 1.5 }).success, false);
    assert.equal(v.safeParse(responseSchema, { paidCents: 1 }).success, false);
    assert.equal(v.safeParse(responseSchema, { requestId, coverageId: 'Medicare' }).success, false);
  });

  it('reads paid dates, check numbers, reason codes and refunds', () => {
    const requestId = '01a16617-7704-7ba6-b9b5-9c79fa44f965';
    const paid = v.parse(responseSchema, {
      requestId,
      paidCents: 500,
      paidOn: '2026-10-20',
      checkNumber: ' EFT-9 ',
      adjustments: [{ group: 'CO', reason: ' 45 ', cents: 100 }]
    });
    assert.equal(paid.checkNumber, 'EFT-9');
    assert.deepEqual(paid.adjustments, [{ group: 'CO', reason: '45', cents: 100 }]);
    const fails = (over: Record<string, unknown>) =>
      !v.safeParse(responseSchema, { requestId, ...over }).success;
    assert.ok(fails({ paidOn: '10/20/2026' }));
    assert.ok(fails({ adjustments: [{ group: 'XX', reason: '45', cents: 1 }] }));
    assert.ok(fails({ adjustments: [{ group: 'CO', reason: 'TOO-LONG', cents: 1 }] }));
    assert.ok(fails({ adjustments: [{ group: 'CO', reason: '45', cents: 0 }] }));
    assert.ok(!fails({ kind: 'refunded', paidCents: 500 }));
    assert.ok(fails({ kind: 'refunded', paidCents: 0 }));
    assert.ok(fails({ kind: 'refunded', paidCents: 500, adjustedCents: 5 }));
    assert.ok(
      fails({
        kind: 'refunded',
        paidCents: 500,
        adjustments: [{ group: 'CO', reason: '45', cents: 1 }]
      })
    );
    assert.ok(fails({ kind: 'reversal' }));
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
        coverages: [
          {
            id: requestId,
            memberId: '1EG',
            groupId: null,
            relationship: null,
            insuredFirstName: null,
            insuredLastName: null,
            remove: false
          }
        ],
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
        originDestination: null,
        documentation: null,
        note: null
      }
    );
    assert.deepEqual(v.parse(billingDataSchema, {}), {
      patient: null,
      coverages: [],
      serviceDate: null,
      pickup: null,
      destination: null,
      diagnoses: null,
      originDestination: null,
      documentation: null,
      note: null
    });
    assert.deepEqual(
      v.parse(billingDataSchema, {
        coverages: [{ id: requestId, relationship: '01', insuredLastName: ' Doe ', remove: true }]
      }).coverages,
      [
        {
          id: requestId,
          memberId: null,
          groupId: null,
          relationship: '01',
          insuredFirstName: null,
          insuredLastName: 'Doe',
          remove: true
        }
      ]
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
    assert.ok(fails({ documentation: { transportReason: 'Z' } }));
    assert.ok(fails({ documentation: { signature: 'maybe' } }));
    assert.deepEqual(
      v.parse(billingDataSchema, { documentation: { signature: 'signed', transportReason: 'D' } })
        .documentation,
      { signature: 'signed', pcsOnFile: null, pcsSignedOn: null, transportReason: 'D' }
    );
    assert.ok(!fails({}));
  });
});

describe('claim paging schemas', () => {
  it('pages claims and history only by the sizes and sorts the lists offer', () => {
    assert.deepEqual(v.parse(claimEventsQuery, {}), {
      page: 1,
      pageSize: 25,
      sort: 'when',
      dir: 'desc'
    });
    assert.deepEqual(
      v.parse(claimEventsQuery, { page: '3', pageSize: '100', sort: 'payer', dir: 'asc' }),
      { page: 3, pageSize: 100, sort: 'payer', dir: 'asc' }
    );
    const fails = (schema: typeof claimEventsQuery | typeof listClaimsQuery, q: object) =>
      !v.safeParse(schema, q).success;
    assert.ok(fails(claimEventsQuery, { sort: 'created' }));
    assert.ok(fails(claimEventsQuery, { dir: 'up' }));
    assert.ok(fails(listClaimsQuery, { page: '0' }));
    assert.ok(fails(listClaimsQuery, { page: '1.5' }));
    assert.ok(fails(listClaimsQuery, { pageSize: '7' }));
    assert.ok(fails(listClaimsQuery, { number: 'x'.repeat(41) }));
  });
});
