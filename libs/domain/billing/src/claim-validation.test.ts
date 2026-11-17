import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type ClaimCheck, claimRecordOf, readIssues, readNewClaim } from './claim-validation.ts';
import { COMPLETE_DOCUMENTATION } from './testing.ts';

const claim = {
  pcrNumber: ' PCR-1 ',
  patientId: 'p1',
  classification: 'emergency',
  serviceDate: '2026-10-01T08:15:00Z',
  level: 'ALS1',
  emergency: true,
  loadedMiles: 12.4,
  lines: [{ code: 'A0427', units: 1, unitCents: 100_000, totalCents: 100_000 }],
  totalCents: 100_000,
  coverages: [{ payer: 'Medicare', priority: '2611003' }],
  report: { bucket: 'ugula', key: 'imports/t/f.xml.reports/00000.json' }
};

const place = { addressLine: '9 Oak Ave', city: 'Springfield', state: 'IL', postalCode: '62702' };

const medicare = {
  coverageId: 'cov-1',
  name: 'Medicare',
  payerId: 'p-mcr',
  claimFiling: 'MB',
  memberId: '1EG4TE5MK73',
  relationship: '18',
  insuredFirstName: null,
  insuredLastName: null,
  filingLimitDays: null,
  eligibility: null,
  eligibilityNote: null,
  stay: null
};

const check: ClaimCheck = {
  patientId: 'p1',
  patient: place,
  pcrNumber: 'PCR-1',
  classification: 'emergency',
  level: 'ALS1',
  emergency: true,
  loadedMiles: 7.3,
  deceased: false,
  nonCoveredMiles: null,
  pickupFacility: null,
  destinationFacility: null,
  responsibleParty: 'payer',
  responsibilityRecorded: false,
  pickupLocality: null,
  zipStates: { pickup: null, destination: null, patient: null },
  diagnosisCodes: [],
  documents: ['pcs'],
  timeZone: 'America/Chicago',
  lines: [
    { code: 'A0427', units: 1, unitCents: 85_000, totalCents: 85_000 },
    { code: 'A0425', units: 7.3, unitCents: 1_000, totalCents: 7_300 }
  ],
  totalCents: 92_300,
  payers: [medicare],
  details: {
    serviceDate: '2026-10-01',
    pickup: { name: null, ...place },
    destination: { name: 'Mercy', ...place },
    diagnoses: ['R079'],
    originDestination: 'RH',
    documentation: COMPLETE_DOCUMENTATION
  }
};

const asOf = new Date('2027-09-20T12:00:00Z');

describe('claimRecordOf', () => {
  it('states the saved claim as it is stored, for the Check Facts rule', () => {
    const record = claimRecordOf(
      { ...check, diagnosisCodes: [{ code: 'R079', description: 'Chest pain', billable: true }] },
      asOf
    );
    assert.equal(record.today, '2027-09-20');
    assert.deepEqual(record.lineCodes, ['A0427', 'A0425']);
    assert.deepEqual(record.lineTotalCents, [85_000, 7_300]);
    assert.deepEqual(record.diagnoses, [
      { code: 'R07.9', description: 'Chest pain', billable: true }
    ]);
    assert.deepEqual(record.pickup, place);
    assert.equal(record.payers[0]?.claimFiling, 'MB');
    assert.equal(record.payers[0]?.stayKind, null);
    assert.equal(claimRecordOf({ ...check, patient: null }, asOf).patient, null);
  });

  it("gives today by the agency's calendar, not UTC", () => {
    const evening = new Date('2027-09-21T03:00:00Z');
    assert.equal(claimRecordOf(check, evening).today, '2027-09-20');
    assert.equal(claimRecordOf({ ...check, timeZone: 'UTC' }, evening).today, '2027-09-21');
  });
});

describe('readIssues', () => {
  it('keeps the issues a graph returned, with their code, and drops malformed ones', () => {
    const issues = readIssues([
      {
        code: 'member-id-missing',
        severity: 'blocking',
        field: 'memberId',
        message: 'The member ID is missing',
        coverageId: 'cov-1'
      },
      { severity: 'warning', field: 'times', message: 'Out of order', coverageId: null },
      { severity: 'off', field: 'times', message: 'Ignored' },
      { severity: 'warning', field: 'nowhere', message: 'Unknown field' },
      'nonsense'
    ]);
    assert.deepEqual(issues, [
      {
        code: 'member-id-missing',
        severity: 'blocking',
        field: 'memberId',
        message: 'The member ID is missing',
        coverageId: 'cov-1'
      },
      {
        code: 'times',
        severity: 'warning',
        field: 'times',
        message: 'Out of order',
        coverageId: null
      }
    ]);
    assert.deepEqual(readIssues(null), []);
  });
});

describe('readNewClaim', () => {
  it('normalizes a draft claim, leaving what a biller fixes later to the checks', () => {
    const read = readNewClaim({ ...claim, serviceDate: null, totalCents: 5 });
    assert.equal(read.pcrNumber, 'PCR-1');
    assert.equal(read.classification, 'emergency');
    assert.equal(read.reportKey, 'imports/t/f.xml.reports/00000.json');
    assert.equal(read.details.serviceDate, null);
    assert.equal(read.totalCents, 100_000);
    assert.equal(read.coverages[0]?.payer, 'Medicare');
    assert.equal(readNewClaim({ ...claim, classification: 'transfer' }).classification, null);
    assert.deepEqual([read.deceased, read.nonCoveredMiles], [false, null]);
    const dead = readNewClaim({ ...claim, deceased: true, nonCoveredMiles: 3.2 });
    assert.deepEqual([dead.deceased, dead.nonCoveredMiles], [true, 3.2]);
  });

  it('faults on a claim the flow could never have built', () => {
    assert.throws(() => readNewClaim({ ...claim, patientId: '' }), /needs a patient/);
    assert.throws(() => readNewClaim({ ...claim, level: 'X' }), /level of service/);
    assert.throws(() => readNewClaim({ ...claim, lines: [{ code: 'A0427', units: 1 }] }), /priced/);
  });
});
