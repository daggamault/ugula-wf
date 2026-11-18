import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CLAIM_STATUS_LABELS,
  CLAIM_STATUSES,
  type ClaimValue,
  isEditable,
  readClaim,
  wasSent
} from './claims.ts';

describe('claim statuses', () => {
  it('edits a claim until a payer has it, and knows which were sent', () => {
    assert.deepEqual(CLAIM_STATUSES.filter(isEditable), [
      'needs_review',
      'approved',
      'on_hold',
      'rejected'
    ]);
    assert.deepEqual(
      CLAIM_STATUSES.filter((s) => !wasSent(s)),
      ['needs_review', 'approved', 'on_hold']
    );
  });

  it('labels every status', () => {
    assert.deepEqual(
      CLAIM_STATUSES.map((s) => CLAIM_STATUS_LABELS[s]),
      [
        'Needs Review',
        'Approved',
        'On Hold',
        'Sent',
        'Rejected',
        'Denied',
        'Patient Balance',
        'Closed'
      ]
    );
  });
});

const CLAIM: ClaimValue = {
  encounterId: 'e-1',
  patientId: 'p-1',
  classification: 'emergency',
  serviceDate: '2026-09-14T07:52:00-04:00',
  level: 'ALS1',
  emergency: true,
  loadedMiles: 11.6,
  originCode: 'r',
  destinationCode: 'H',
  diagnoses: ['R07.9', 'I10', 'R079'],
  transportReason: 'a',
  conditionCodes: ['06', '09', '06', ' '],
  weightPounds: 180,
  pickup: { name: ' ', line: '1 Elm St', city: 'Dayton', state: 'oh', postalCode: '45402-1234' },
  destination: null,
  priorAuthorization: ' PA-1 ',
  signatureOnFile: true,
  note: ' Chest pain, unable to walk ',
  coverages: [
    {
      payerName: 'Medicare',
      payerId: 'pay-1',
      memberId: 'M1',
      groupId: null,
      relationship: null,
      insuredFirstName: null,
      insuredLastName: null
    }
  ],
  lines: [
    { code: 'a0427', modifiers: ['rh'], units: 1, unitCents: 80000, totalCents: 80000 },
    { code: 'A0425', modifiers: [], units: 11.6, unitCents: 1500, totalCents: 17400 }
  ],
  totalCents: 97400,
  reasons: ['Emergency response', ' ', null]
};

const line = (patch: object) => ({
  code: 'A0427',
  modifiers: [],
  units: 1,
  unitCents: 1,
  totalCents: 1,
  ...patch
});

describe('readClaim', () => {
  it('normalizes a claim built on the canvas', () => {
    const c = readClaim(CLAIM);
    assert.deepEqual(
      [c.serviceDate, c.originCode, c.destinationCode, c.diagnoses, c.totalCents, c.reasons],
      ['2026-09-14', 'R', 'H', ['R079', 'I10'], 97400, ['Emergency response']]
    );
    assert.deepEqual(
      [c.transportReason, c.conditionCodes, c.weightPounds],
      ['A', ['06', '09'], 180]
    );
    assert.deepEqual(c.lines[0], {
      code: 'A0427',
      modifiers: ['RH'],
      units: 1,
      unitCents: 80000,
      totalCents: 80000
    });
    assert.deepEqual(c.coverages[0], {
      payerId: 'pay-1',
      payerName: 'Medicare',
      memberId: 'M1',
      groupId: null,
      relationship: '18',
      insuredFirstName: null,
      insuredLastName: null
    });
  });

  it('normalizes the locations, prior authorization and note the 837P needs', () => {
    const c = readClaim(CLAIM);
    assert.deepEqual(c.pickup, {
      name: null,
      line: '1 Elm St',
      city: 'Dayton',
      state: 'OH',
      postalCode: '454021234'
    });
    assert.deepEqual(c.destination, {
      name: null,
      line: null,
      city: null,
      state: null,
      postalCode: null
    });
    assert.deepEqual(
      [c.priorAuthorization, c.signatureOnFile, c.note],
      ['PA-1', true, 'Chest pain, unable to walk']
    );
    assert.equal(readClaim({ ...CLAIM, signatureOnFile: null }).signatureOnFile, false);
  });

  it('allows a claim with no lines, payers, diagnoses or trip', () => {
    const c = readClaim({
      ...CLAIM,
      lines: [],
      coverages: null,
      diagnoses: null,
      totalCents: null,
      loadedMiles: null,
      originCode: null,
      destinationCode: null,
      serviceDate: null,
      transportReason: null,
      conditionCodes: null,
      weightPounds: null
    });
    assert.deepEqual(
      [c.lines, c.coverages, c.totalCents, c.originCode, c.transportReason, c.conditionCodes],
      [[], [], 0, null, null, []]
    );
  });

  it('says what is wrong with a claim it cannot save', () => {
    const wrong = (patch: object, message: RegExp) =>
      assert.throws(
        () => readClaim({ ...CLAIM, totalCents: null, ...patch } as ClaimValue),
        message
      );
    wrong({ patientId: null }, /needs its patient/);
    wrong({ encounterId: '' }, /needs its encounter/);
    wrong({ classification: 'maybe' }, /maybe is not a classification/);
    wrong({ level: 'ALS3' }, /ALS3 is not a level of service/);
    wrong({ emergency: null }, /say if it is an emergency/);
    wrong({ loadedMiles: -1 }, /Loaded miles/);
    wrong({ serviceDate: 'today' }, /today is not a date/);
    wrong({ originCode: 'X', destinationCode: 'H' }, /XH is not an origin/);
    wrong({ originCode: 'R', destinationCode: null }, /R\? is not an origin/);
    wrong({ diagnoses: ['chest pain'] }, /CHEST PAIN is not an ICD-10/);
    wrong({ transportReason: 'F' }, /F is not a transport reason/);
    wrong({ conditionCodes: ['02'] }, /02 is not an ambulance condition/);
    wrong({ conditionCodes: ['01', '04', '05', '06', '07', '08'] }, /at most 5 condition/);
    wrong({ weightPounds: 180.5 }, /whole number of pounds/);
    wrong({ weightPounds: 0 }, /whole number of pounds/);
    wrong({ note: 'x'.repeat(81) }, /note takes at most 80 characters/);
    wrong({ totalCents: 1 }, /not the sum of the lines, 97400/);
    wrong({ lines: [line({ code: 'X1' })] }, /Line 1 has no valid/);
    wrong({ lines: [line({ modifiers: ['RHX'] })] }, /invalid modifier RHX/);
    wrong({ lines: [line({ modifiers: ['A1', 'B1', 'C1', 'D1', 'E1'] })] }, /more than 4/);
    wrong({ lines: [line({ units: 0 })] }, /positive number/);
    wrong({ lines: [line({ unitCents: null })] }, /not been priced/);
    wrong({ coverages: [{ payerName: ' ' }] }, /Payer 1 has no name/);
    wrong({ coverages: [{ payerName: 'X', relationship: '2622001' }] }, /not an X12 code/);
  });
});
