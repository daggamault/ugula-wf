import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  type ClaimCheck,
  checkFactsOf,
  isBlocking,
  readIssues,
  readNewClaim
} from './claim-validation.ts';
import { COMPLETE_DOCUMENTATION } from './testing.ts';

const claim = {
  pcrNumber: ' PCR-1 ',
  patientId: 'p1',
  tripType: 'emergency',
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
  tripType: 'emergency',
  level: 'ALS1',
  emergency: true,
  loadedMiles: 7.3,
  deceased: false,
  nonCoveredMiles: null,
  pickupFacility: null,
  destinationFacility: null,
  responsibleParty: 'payer',
  responsibilityRecorded: false,
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

describe('checkFactsOf', () => {
  it('states what the checks read about a complete claim', () => {
    const facts = checkFactsOf(check, asOf);
    assert.equal(facts.patientLinked, true);
    assert.deepEqual(facts.patientAddressMissing, []);
    assert.equal(facts.transports, true);
    assert.equal(checkFactsOf({ ...check, deceased: true }, asOf).transports, false);
    assert.equal(facts.levelValid, true);
    assert.equal(facts.linesAddUp, true);
    assert.equal(facts.originDestinationValid, true);
    assert.equal(facts.timesRecorded, true);
    assert.equal(facts.timesInOrder, true);
    assert.equal(facts.billsMedicare, true);
    assert.deepEqual(facts.payers, [
      {
        coverageId: 'cov-1',
        name: 'Medicare',
        linked: true,
        memberId: '1EG4TE5MK73',
        needsInsured: false,
        insuredLastName: null,
        eligibility: null,
        eligibilityNote: null,
        filingLimitDays: 365,
        filingDaysLeft: 11,
        medicare: true,
        stayReported: null
      }
    ]);
    assert.equal(facts.responsibleParty, 'payer');
    assert.equal(facts.recordedParty, null);
    assert.equal(
      checkFactsOf({ ...check, responsibilityRecorded: true }, asOf).recordedParty,
      'payer'
    );
    assert.deepEqual(facts.documents, ['pcs']);
    assert.equal(facts.priorAuthorizationDaysLeft, null);
  });

  it('reads the documented MSP, ABN, prior authorization and stays', () => {
    const facts = checkFactsOf(
      {
        ...check,
        deceased: true,
        details: {
          ...check.details,
          documentation: {
            ...COMPLETE_DOCUMENTATION,
            abnOnFile: true,
            mspAccident: 'workersComp',
            priorAuthorizationExpiresOn: '2026-10-21',
            roundTrips: 5,
            pcsType: 'repetitive',
            facilityStay: 'snf'
          }
        },
        payers: [
          {
            ...medicare,
            stay: { kind: 'inpatient', admittedOn: '2026-09-28', dischargedOn: null }
          },
          {
            ...medicare,
            coverageId: 'cov-2',
            claimFiling: 'CI',
            stay: { kind: 'snf', admittedOn: '2026-09-01', dischargedOn: '2026-09-30' }
          }
        ]
      },
      asOf
    );
    assert.equal(facts.deceased, true);
    assert.equal(facts.abnOnFile, true);
    assert.equal(facts.mspAccident, 'workersComp');
    assert.equal(facts.priorAuthorizationDaysLeft, 20);
    assert.equal(facts.roundTrips, 5);
    assert.equal(facts.facilityStay, 'snf');
    assert.deepEqual(
      facts.payers.map((p) => [p.medicare, p.stayReported]),
      [
        [true, 'inpatient'],
        [false, null]
      ]
    );
  });

  it('does the date math and lists the missing address parts', () => {
    const facts = checkFactsOf(
      {
        ...check,
        patient: { ...place, postalCode: null, city: null },
        tripType: 'refusal',
        totalCents: 5,
        details: {
          ...check.details,
          pickup: { name: null, ...place, state: null },
          originDestination: 'Q',
          documentation: {
            ...COMPLETE_DOCUMENTATION,
            pcsSignedOn: '2026-08-01',
            atDestination: '2025-12-30T10:10:00Z'
          }
        },
        payers: [{ ...medicare, payerId: null, relationship: '01', claimFiling: 'CI' }]
      },
      asOf
    );
    assert.deepEqual(facts.patientAddressMissing, ['city', 'ZIP code']);
    assert.deepEqual(facts.pickupMissing, ['state']);
    assert.equal(facts.transports, false);
    assert.equal(facts.linesAddUp, false);
    assert.equal(facts.originDestinationValid, false);
    assert.equal(facts.timesInOrder, false);
    assert.equal(facts.pcsDaysBeforeTrip, 61);
    assert.equal(facts.billsMedicare, false);
    assert.deepEqual(
      facts.payers.map((p) => [p.linked, p.needsInsured, p.filingLimitDays, p.filingDaysLeft]),
      [[false, true, null, null]]
    );
  });

  it('leaves the date facts empty without the dates they need', () => {
    const facts = checkFactsOf(
      { ...check, patient: null, details: { ...check.details, serviceDate: null } },
      asOf
    );
    assert.deepEqual(facts.patientAddressMissing, []);
    assert.equal(facts.pcsDaysBeforeTrip, null);
    assert.equal(facts.payers[0]?.filingDaysLeft, null);
  });

  it("counts filing days left by the agency's calendar, not UTC", () => {
    const evening = new Date('2027-09-21T03:00:00Z');
    assert.equal(checkFactsOf(check, evening).payers[0]?.filingDaysLeft, 11);
    assert.equal(
      checkFactsOf({ ...check, timeZone: 'UTC' }, evening).payers[0]?.filingDaysLeft,
      10
    );
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
    assert.ok(isBlocking(issues));
    assert.ok(!isBlocking(issues.slice(1)));
    assert.deepEqual(readIssues(null), []);
  });
});

describe('readNewClaim', () => {
  it('normalizes a draft claim, leaving what a biller fixes later to the checks', () => {
    const read = readNewClaim({ ...claim, serviceDate: null, totalCents: 5 });
    assert.equal(read.pcrNumber, 'PCR-1');
    assert.equal(read.tripType, 'emergency');
    assert.equal(read.reportKey, 'imports/t/f.xml.reports/00000.json');
    assert.equal(read.details.serviceDate, null);
    assert.equal(read.totalCents, 100_000);
    assert.equal(read.coverages[0]?.payer, 'Medicare');
    assert.equal(readNewClaim({ ...claim, tripType: 'transfer' }).tripType, null);
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
