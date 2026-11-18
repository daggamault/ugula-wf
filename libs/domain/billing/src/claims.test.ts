import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CLAIM_STATUS_LABELS, CLAIM_STATUSES, type ClaimValue, readClaim } from './claims.ts';

describe('claim statuses', () => {
  it('labels every status', () => {
    assert.deepEqual(
      CLAIM_STATUSES.map((s) => CLAIM_STATUS_LABELS[s]),
      ['Needs Review']
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
      serviceDate: null
    });
    assert.deepEqual([c.lines, c.coverages, c.totalCents, c.originCode], [[], [], 0, null]);
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
