import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  abnErrorOf,
  countErrorOf,
  fromDraft,
  hasCountError,
  modifierErrorOf,
  toDraft
} from './claim-data-draft.ts';
import type { ClaimDetail } from './client.ts';

const claim = {
  id: 'c1',
  coverages: [
    { id: 'cov-m', payer: 'Medicare', member_id: '1EG4', group_id: null },
    { id: 'cov-b', payer: 'Blue Plan', member_id: null, group_id: null }
  ],
  service_date: '2026-10-01',
  pickup_address_line: '9 Elm St',
  pickup_city: null,
  pickup_state: 'IL',
  pickup_postal_code: '62704',
  destination_name: 'St. Mary',
  destination_address_line: null,
  destination_city: null,
  destination_state: null,
  destination_postal_code: null,
  diagnoses: ['R079', 'I10'],
  origin_code: 'S',
  destination_code: 'H',
  address_line: '1 Main St',
  city: null,
  state: 'IL',
  postal_code: '62704',
  signature: 'missing',
  transport_reason: null,
  pcs_on_file: null,
  pcs_signed_on: null,
  patient_count: null,
  closest_facility_miles: null,
  abn_on_file: null,
  abn_signed_on: null,
  denial_expected: null,
  msp_employer_plan: null,
  msp_esrd: null,
  msp_disability: null,
  msp_accident: null,
  prior_authorization: null,
  prior_authorization_expires_on: null,
  pcs_type: null,
  round_trips: null,
  admission_date: null,
  facility_stay: null
} as unknown as ClaimDetail;

describe('claim data draft', () => {
  it('sends only the documentation a biller changed', () => {
    const before = toDraft(claim);
    assert.equal(fromDraft(before, before).documentation, null);
    assert.deepEqual(
      fromDraft(
        {
          ...before,
          signature: 'signed',
          transportReason: 'D',
          pcsOnFile: 'yes',
          pcsSignedOn: '2026-09-20'
        },
        before
      ).documentation,
      {
        signature: 'signed',
        pcsOnFile: true,
        pcsSignedOn: '2026-09-20',
        transportReason: 'D'
      }
    );
    assert.deepEqual(fromDraft({ ...before, pcsOnFile: 'no' }, before).documentation, {
      pcsOnFile: false
    });
  });

  it('clears documentation a biller emptied', () => {
    const before = toDraft({
      ...claim,
      round_trips: 3,
      patient_count: 2,
      pcs_signed_on: '2026-09-01',
      prior_authorization: 'UTN-1',
      transport_reason: 'D',
      msp_esrd: true
    } as ClaimDetail);
    assert.deepEqual(
      fromDraft(
        {
          ...before,
          roundTrips: '',
          patientCount: ' ',
          pcsSignedOn: '',
          priorAuthorization: '',
          transportReason: '',
          mspEsrd: ''
        },
        before
      ).documentation,
      {
        pcsSignedOn: null,
        transportReason: null,
        patientCount: null,
        mspEsrd: null,
        priorAuthorization: null,
        roundTrips: null
      }
    );
  });

  it('sends the MSP answers, ABN, authorization, counts and facility stay a biller changed', () => {
    const before = toDraft(claim);
    assert.deepEqual(
      fromDraft(
        {
          ...before,
          patientCount: '2',
          abnOnFile: 'yes',
          abnSignedOn: '2026-09-30',
          denialExpected: 'no',
          mspEmployerPlan: 'no',
          mspAccident: 'workersComp',
          priorAuthorization: ' UTN-7 ',
          priorAuthorizationExpiresOn: '2026-12-01',
          pcsType: 'repetitive',
          roundTrips: '4',
          admissionDate: '2026-09-29',
          facilityStay: 'snf'
        },
        before
      ).documentation,
      {
        patientCount: 2,
        abnOnFile: true,
        abnSignedOn: '2026-09-30',
        denialExpected: false,
        mspEmployerPlan: false,
        mspAccident: 'workersComp',
        priorAuthorization: 'UTN-7',
        priorAuthorizationExpiresOn: '2026-12-01',
        pcsType: 'repetitive',
        roundTrips: 4,
        admissionDate: '2026-09-29',
        facilityStay: 'snf'
      }
    );
    assert.equal(fromDraft({ ...before, patientCount: 'x' }, before).documentation, null);
    const answered = toDraft({ ...claim, msp_esrd: true, round_trips: 3 } as ClaimDetail);
    assert.deepEqual([answered.mspEsrd, answered.roundTrips], ['yes', '3']);
  });

  it('round-trips claim data, blanks becoming missing values', () => {
    const draft = toDraft(claim);
    assert.deepEqual(draft.coverages, [
      { id: 'cov-m', payer: 'Medicare', memberId: '1EG4', groupId: '' },
      { id: 'cov-b', payer: 'Blue Plan', memberId: '', groupId: '' }
    ]);
    assert.equal(draft.diagnoses, 'R079, I10');
    const data = fromDraft({ ...draft, diagnoses: ' R07.9,I10  E11.9 ' });
    assert.deepEqual(data.diagnoses, ['R07.9', 'I10', 'E11.9']);
    assert.deepEqual(data.patient, {
      addressLine: '1 Main St',
      city: null,
      state: 'IL',
      postalCode: '62704'
    });
    assert.deepEqual(data.coverages[1], { id: 'cov-b', memberId: null, groupId: null });
    assert.equal(data.serviceDate, '2026-10-01');
    assert.equal(data.pickup.addressLine, '9 Elm St');
    assert.equal(data.destination.name, 'St. Mary');
    assert.equal(data.originDestination, 'SH');
    assert.deepEqual([draft.originCode, draft.destinationCode], ['S', 'H']);
    assert.equal(fromDraft({ ...draft, destinationCode: '' }).originDestination, null);
  });

  it('ignores documentation values that are not a known code', () => {
    const before = toDraft(claim);
    assert.equal(
      fromDraft({ ...before, signature: 'bogus', transportReason: 'Z' }, before).documentation,
      null
    );
    assert.equal(
      fromDraft({ ...before, pcsSignedOn: ' 2026-09-20 ' }, before).documentation?.pcsSignedOn,
      '2026-09-20'
    );
  });
});

describe('countErrorOf', () => {
  it('refuses counts that are not whole numbers at or above their minimum, and allows blanks', () => {
    const d = { patientCount: '2', roundTrips: '0' };
    assert.equal(countErrorOf(d, 'patientCount'), undefined);
    assert.equal(countErrorOf(d, 'roundTrips'), undefined);
    assert.equal(countErrorOf({ ...d, patientCount: ' ' }, 'patientCount'), undefined);
    for (const bad of ['x', '1.5', '0', '-2']) {
      assert.match(
        countErrorOf({ ...d, patientCount: bad }, 'patientCount') ?? '',
        /whole number of 1 or more/
      );
    }
    assert.match(countErrorOf({ ...d, roundTrips: '-1' }, 'roundTrips') ?? '', /0 or more/);
  });
});

describe('hasCountError', () => {
  it('flags a draft when either count is invalid', () => {
    assert.equal(hasCountError({ patientCount: '', roundTrips: '' }), false);
    assert.equal(hasCountError({ patientCount: '2', roundTrips: '0' }), false);
    assert.equal(hasCountError({ patientCount: '2', roundTrips: '-1' }), true);
    assert.equal(hasCountError({ patientCount: '0', roundTrips: '' }), true);
  });
});

describe('abnErrorOf', () => {
  it('dates an ABN only when one is on file', () => {
    assert.equal(abnErrorOf({ abnOnFile: 'yes', abnSignedOn: '2026-09-01' }), undefined);
    assert.equal(abnErrorOf({ abnOnFile: '', abnSignedOn: '' }), undefined);
    assert.match(
      abnErrorOf({ abnOnFile: 'no', abnSignedOn: '2026-09-01' }) ?? '',
      /before dating it/
    );
    assert.match(abnErrorOf({ abnOnFile: '', abnSignedOn: '2026-09-01' }) ?? '', /ABN on file/);
  });
});

describe('modifierErrorOf', () => {
  it('needs both transport types or neither', () => {
    assert.equal(modifierErrorOf({ originCode: 'R', destinationCode: 'H' }), undefined);
    assert.equal(modifierErrorOf({ originCode: '', destinationCode: '' }), undefined);
    assert.match(modifierErrorOf({ originCode: 'R', destinationCode: '' }) ?? '', /both/);
  });
});
