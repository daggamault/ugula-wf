import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MAX_LOADED_MILES } from './charges.ts';
import {
  employerSizeOf,
  isSignatureStatus,
  isTransportReason,
  MAX_DOCUMENTED_COUNT,
  MAX_EMPLOYER_SIZE,
  pcsOnFileOf,
  poundsOf,
  readDocumentation
} from './documentation.ts';

describe('readDocumentation', () => {
  it('keeps only valid codes, dates, times and weights', () => {
    assert.deepEqual(
      readDocumentation({
        signature: 'signed',
        pcsOnFile: '9922005',
        pcsSignedOn: '2026-09-01T00:00:00Z',
        transportReason: 'd',
        conditionCodes: ['09', '06', '09', '99', '01', '04', '05', '07'],
        priorAuthorization: ' PA-1 ',
        weightKg: 81.6,
        atScene: 'not a time',
        leftScene: '2026-09-01T10:00:00Z',
        atDestination: null
      }),
      {
        signature: 'signed',
        signatureNote: null,
        pcsOnFile: true,
        pcsSignedOn: '2026-09-01',
        transportReason: 'D',
        conditionCodes: ['09', '06', '01', '04', '05'],
        priorAuthorization: 'PA-1',
        weightKg: 81.6,
        atScene: null,
        leftScene: '2026-09-01T10:00:00Z',
        atDestination: null,
        patientCount: null,
        closestFacilityMiles: null,
        abnOnFile: null,
        abnSignedOn: null,
        denialExpected: null,
        mspEmployerPlan: null,
        mspEsrd: null,
        mspDisability: null,
        mspEmployerSize: null,
        mspAccident: null,
        priorAuthorizationExpiresOn: null,
        pcsType: null,
        roundTrips: null,
        admissionDate: null,
        facilityStay: null
      }
    );
    assert.equal(readDocumentation({ signature: 'maybe' }).signature, 'missing');
    assert.equal(readDocumentation({ weightKg: -3 }).weightKg, null);
    assert.deepEqual(readDocumentation({ conditionCodes: '09' }).conditionCodes, []);
  });

  it('reads a missing record as nothing documented and the signature as missing', () => {
    const read = readDocumentation(null);
    assert.deepEqual(
      [read.signature, read.signatureNote, read.conditionCodes, read.transportReason],
      ['missing', null, [], null]
    );
  });

  it('keeps the note on a signature exception and the ESRD and disability answers', () => {
    const read = readDocumentation({
      signature: 'exception',
      signatureNote: ' Unconscious ',
      mspEsrd: true,
      mspDisability: false,
      mspEmployerSize: 25
    });
    assert.deepEqual(
      [read.signature, read.signatureNote, read.mspEsrd, read.mspDisability, read.mspEmployerSize],
      ['exception', 'Unconscious', true, false, 25]
    );
  });

  it('bounds patient counts at one and round trips at zero, both up to the documented maximum', () => {
    const counts = (n: number) => {
      const r = readDocumentation({ patientCount: n, roundTrips: n });
      return [r.patientCount, r.roundTrips];
    };
    assert.deepEqual(counts(0), [null, 0]);
    assert.deepEqual(counts(1), [1, 1]);
    assert.deepEqual(counts(MAX_DOCUMENTED_COUNT), [MAX_DOCUMENTED_COUNT, MAX_DOCUMENTED_COUNT]);
    assert.deepEqual(counts(MAX_DOCUMENTED_COUNT + 1), [null, null]);
  });

  it('keeps the MSP answers, ABN, prior authorization, counts and stays it can trust', () => {
    const read = readDocumentation({
      patientCount: 2,
      closestFacilityMiles: 4.6,
      abnOnFile: true,
      abnSignedOn: '2026-08-30',
      denialExpected: 'yes',
      mspEmployerPlan: false,
      mspAccident: 'noFault',
      priorAuthorizationExpiresOn: '2026-12-01T00:00:00Z',
      pcsType: 'repetitive',
      roundTrips: 4,
      admissionDate: '2026-08-29',
      facilityStay: 'inpatient'
    });
    assert.deepEqual(
      [
        read.patientCount,
        read.closestFacilityMiles,
        read.abnOnFile,
        read.abnSignedOn,
        read.denialExpected,
        read.mspEmployerPlan,
        read.mspAccident,
        read.priorAuthorizationExpiresOn,
        read.pcsType,
        read.roundTrips,
        read.admissionDate,
        read.facilityStay
      ],
      [
        2,
        4.6,
        true,
        '2026-08-30',
        null,
        false,
        'noFault',
        '2026-12-01',
        'repetitive',
        4,
        '2026-08-29',
        'inpatient'
      ]
    );
    const bad = readDocumentation({
      patientCount: 0,
      closestFacilityMiles: -1,
      mspAccident: 'flood',
      pcsType: 'weekly',
      roundTrips: 1.5,
      facilityStay: 'hotel'
    });
    assert.deepEqual(
      [
        bad.patientCount,
        bad.closestFacilityMiles,
        bad.mspAccident,
        bad.pcsType,
        bad.roundTrips,
        bad.facilityStay
      ],
      [null, null, null, null, null, null]
    );
    assert.equal(
      readDocumentation({ closestFacilityMiles: MAX_LOADED_MILES }).closestFacilityMiles,
      MAX_LOADED_MILES
    );
    assert.equal(
      readDocumentation({ closestFacilityMiles: MAX_LOADED_MILES + 1 }).closestFacilityMiles,
      null
    );
  });

  it('converts NEMSIS yes/no codes, weights and day spans', () => {
    assert.deepEqual(['9922005', '9922001', '9922003', false].map(pcsOnFileOf), [
      true,
      false,
      null,
      false
    ]);
    assert.equal(poundsOf(81.6), 180);
    assert.equal(poundsOf(null), null);
    assert.deepEqual([true, 'yes', undefined].map(pcsOnFileOf), [true, null, null]);
    assert.equal(readDocumentation({ weightKg: 1000 }).weightKg, null);
    assert.equal(readDocumentation({ transportReason: 'F' }).transportReason, null);
  });
});

describe('employerSizeOf', () => {
  it('keeps a whole number of employees from one to the maximum', () => {
    assert.deepEqual(
      [1, 20, MAX_EMPLOYER_SIZE, 0, MAX_EMPLOYER_SIZE + 1, 2.5, '20', null].map(employerSizeOf),
      [1, 20, MAX_EMPLOYER_SIZE, null, null, null, null, null]
    );
  });
});

describe('documentation guards', () => {
  it('knows the signature statuses and the transport reasons A to E', () => {
    assert.deepEqual(['signed', 'refused', 'missing', 'maybe', null].map(isSignatureStatus), [
      true,
      true,
      true,
      false,
      false
    ]);
    assert.deepEqual(['A', 'E', 'a', 'F', 'toString', 1].map(isTransportReason), [
      true,
      true,
      false,
      false,
      false,
      false
    ]);
  });
});
