import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readDocumentation } from '@ugula/billing';
import {
  DOCUMENTATION_COLUMNS,
  documentationOf,
  documentationValues
} from './claim-documentation.ts';

const full = readDocumentation({
  signature: 'exception',
  signatureNote: 'Not signed because the patient was unconscious',
  pcsOnFile: true,
  pcsSignedOn: '2026-09-01',
  transportReason: 'A',
  conditionCodes: ['09', '06'],
  priorAuthorization: 'PA-1',
  weightKg: 81.6,
  atScene: '2026-09-14T12:05:00.000Z',
  leftScene: '2026-09-14T12:25:00.000Z',
  atDestination: '2026-09-14T12:50:00.000Z',
  patientCount: 2,
  closestFacilityMiles: 4.6,
  abnOnFile: true,
  abnSignedOn: '2026-09-13',
  denialExpected: false,
  mspEmployerPlan: true,
  mspEsrd: false,
  mspDisability: true,
  mspEmployerSize: 25,
  mspAccident: 'noFault',
  priorAuthorizationExpiresOn: '2026-12-31',
  pcsType: 'repetitive',
  roundTrips: 4,
  admissionDate: '2026-09-10',
  facilityStay: 'snf'
});

const fullRow = {
  signature: 'exception',
  signature_note: 'Not signed because the patient was unconscious',
  has_pcs: true,
  pcs_signed_on: '2026-09-01',
  transport_reason: 'A',
  condition_codes: ['09', '06'],
  prior_authorization: 'PA-1',
  weight_kg: 81.6,
  at_scene_at: '2026-09-14T12:05:00.000Z',
  left_scene_at: '2026-09-14T12:25:00.000Z',
  at_destination_at: '2026-09-14T12:50:00.000Z',
  patient_count: 2,
  closest_facility_miles: 4.6,
  has_abn: true,
  abn_signed_on: '2026-09-13',
  is_denial_expected: false,
  has_msp_employer_plan: true,
  has_msp_esrd: false,
  has_msp_disability: true,
  msp_employer_size: 25,
  msp_accident: 'noFault',
  prior_authorization_expires_on: '2026-12-31',
  pcs_type: 'repetitive',
  round_trips: 4,
  admitted_on: '2026-09-10',
  facility_stay: 'snf'
};

describe('DOCUMENTATION_COLUMNS', () => {
  it('selects exactly the claim columns documentationValues writes', () => {
    assert.deepEqual(
      DOCUMENTATION_COLUMNS.map((c) => c.slice(2)),
      Object.keys(documentationValues(full))
    );
  });
});

describe('documentationValues', () => {
  it('maps every documentation field to its claim column', () => {
    assert.deepEqual(documentationValues(full), fullRow);
  });

  it('writes null for unrecorded fields and no condition codes as an empty list', () => {
    const values = documentationValues(readDocumentation({ signature: 'signed' }));
    assert.deepEqual(
      Object.entries(values).filter(([, v]) => v !== null),
      [
        ['signature', 'signed'],
        ['condition_codes', []]
      ]
    );
  });
});

describe('documentationOf', () => {
  it('reads numeric strings as numbers and timestamps as ISO strings', () => {
    const row = {
      ...fullRow,
      weight_kg: '81.6',
      closest_facility_miles: '4.6',
      at_scene_at: new Date('2026-09-14T12:05:00Z'),
      left_scene_at: new Date('2026-09-14T12:25:00Z'),
      at_destination_at: new Date('2026-09-14T12:50:00Z')
    };
    assert.deepEqual(documentationOf(row), full);
  });

  it('reads missing weight, distance and times as null', () => {
    const doc = readDocumentation({ signature: 'signed' });
    const row = {
      ...documentationValues(doc),
      weight_kg: null,
      closest_facility_miles: null,
      at_scene_at: null,
      left_scene_at: null,
      at_destination_at: null
    };
    assert.deepEqual(documentationOf(row), doc);
  });

  it('keeps a zero distance rather than reading it as missing', () => {
    const row = {
      ...documentationValues(readDocumentation({ signature: 'signed' })),
      weight_kg: null,
      closest_facility_miles: '0',
      at_scene_at: null,
      left_scene_at: null,
      at_destination_at: null
    };
    const read = documentationOf(row);
    assert.equal(read.closestFacilityMiles, 0);
  });
});
