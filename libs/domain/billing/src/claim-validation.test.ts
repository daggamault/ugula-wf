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
    const d = COMPLETE_DOCUMENTATION;
    assert.deepEqual(
      claimRecordOf(
        {
          ...check,
          diagnosisCodes: [{ code: 'R079', description: 'Chest pain', billable: true }],
          zipStates: { pickup: 'IL', destination: 'IL', patient: 'MO' }
        },
        asOf
      ),
      {
        today: '2027-09-20',
        patientId: 'p1',
        patient: place,
        pcrNumber: 'PCR-1',
        serviceDate: '2026-10-01',
        classification: 'emergency',
        level: 'ALS1',
        emergency: true,
        lineCodes: ['A0427', 'A0425'],
        lineTotalCents: [85_000, 7_300],
        totalCents: 92_300,
        diagnosisCount: 1,
        diagnoses: [{ code: 'R07.9', description: 'Chest pain', billable: true }],
        pickup: place,
        destination: place,
        pickupZipKnown: false,
        pickupZipSplit: false,
        pickupZipState: 'IL',
        destinationZipState: 'IL',
        patientZipState: 'MO',
        originDestination: 'RH',
        transportReason: d.transportReason,
        conditionCodes: d.conditionCodes,
        atScene: d.atScene,
        leftScene: d.leftScene,
        atDestination: d.atDestination,
        loadedMiles: 7.3,
        signature: d.signature,
        signatureNote: d.signatureNote,
        pcsOnFile: d.pcsOnFile,
        pcsSignedOn: d.pcsSignedOn,
        pcsType: d.pcsType,
        roundTrips: d.roundTrips,
        priorAuthorization: d.priorAuthorization,
        priorAuthorizationExpiresOn: d.priorAuthorizationExpiresOn,
        deceased: false,
        nonCoveredMiles: null,
        patientCount: d.patientCount,
        abnOnFile: d.abnOnFile,
        abnSignedOn: d.abnSignedOn,
        denialExpected: d.denialExpected,
        mspEmployerPlan: d.mspEmployerPlan,
        mspEsrd: d.mspEsrd,
        mspDisability: d.mspDisability,
        mspEmployerSize: d.mspEmployerSize,
        mspAccident: d.mspAccident,
        facilityStay: d.facilityStay,
        payers: [
          {
            coverageId: 'cov-1',
            name: 'Medicare',
            payerId: 'p-mcr',
            claimFiling: 'MB',
            memberId: '1EG4TE5MK73',
            relationship: '18',
            insuredLastName: null,
            filingLimitDays: null,
            eligibility: null,
            eligibilityNote: null,
            stayKind: null,
            stayAdmittedOn: null,
            stayDischargedOn: null
          }
        ],
        pickupFacility: null,
        destinationFacility: null,
        responsibleParty: 'payer',
        responsibilityRecorded: false,
        documents: ['pcs']
      }
    );
  });

  it('states a missing patient address as blanks and a missing patient as none', () => {
    const empty = { addressLine: null, city: null, state: null, postalCode: null };
    assert.equal(claimRecordOf({ ...check, patient: null }, asOf).patient, null);
    const blank = { ...check.details.pickup, addressLine: null, city: null, state: null };
    const record = claimRecordOf(
      { ...check, details: { ...check.details, pickup: { ...blank, postalCode: null } } },
      asOf
    );
    assert.deepEqual(record.pickup, empty);
  });

  it('knows a pickup ZIP only when the pickup has one, and whether it splits localities', () => {
    const zipOf = (postalCode: string | null, pickupLocality: ClaimCheck['pickupLocality']) => {
      const pickup = { ...check.details.pickup, postalCode };
      const r = claimRecordOf(
        { ...check, pickupLocality, details: { ...check.details, pickup } },
        asOf
      );
      return [r.pickupZipKnown, r.pickupZipSplit];
    };
    assert.deepEqual(zipOf(null, null), [null, false]);
    assert.deepEqual(zipOf('99999', null), [false, false]);
    assert.deepEqual(zipOf('62702', { needsPlusFour: false }), [true, false]);
    assert.deepEqual(zipOf('62702', { needsPlusFour: true }), [true, true]);
  });

  it('states the inpatient or skilled nursing stay a payer reported', () => {
    const stay = { kind: 'snf' as const, admittedOn: '2026-09-28', dischargedOn: null };
    const [payer] = claimRecordOf({ ...check, payers: [{ ...medicare, stay }] }, asOf).payers;
    assert.deepEqual(
      [payer?.stayKind, payer?.stayAdmittedOn, payer?.stayDischargedOn],
      ['snf', '2026-09-28', null]
    );
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
    assert.deepEqual(
      { ...read, details: null, coverages: read.coverages.map((c) => c.payer) },
      {
        patientId: 'p1',
        pcrNumber: 'PCR-1',
        classification: 'emergency',
        level: 'ALS1',
        emergency: true,
        loadedMiles: 12.4,
        deceased: false,
        nonCoveredMiles: null,
        lines: [{ code: 'A0427', units: 1, unitCents: 100_000, totalCents: 100_000 }],
        totalCents: 100_000,
        coverages: ['Medicare'],
        details: null,
        reportKey: 'imports/t/f.xml.reports/00000.json'
      }
    );
    assert.equal(read.details.serviceDate, null);
  });

  it('drops an unknown classification and flags that are not exactly true', () => {
    const read = readNewClaim({
      ...claim,
      classification: 'transfer',
      emergency: 'yes',
      deceased: 1,
      loadedMiles: '12',
      nonCoveredMiles: 0,
      report: 'imports/x.json'
    });
    assert.deepEqual(
      [
        read.classification,
        read.emergency,
        read.deceased,
        read.loadedMiles,
        read.nonCoveredMiles,
        read.reportKey
      ],
      [null, false, false, null, null, null]
    );
    const dead = readNewClaim({ ...claim, deceased: true, nonCoveredMiles: 3.2 });
    assert.deepEqual([dead.deceased, dead.nonCoveredMiles], [true, 3.2]);
  });

  it('faults on a claim the flow could never have built', () => {
    assert.throws(() => readNewClaim(null), /A claim needs a patient/);
    assert.throws(() => readNewClaim({ ...claim, patientId: '' }), /A claim needs a patient/);
    assert.throws(
      () => readNewClaim({ ...claim, level: 'X' }),
      /A claim needs a level of service: BLS, ALS1, ALS2, SCT/
    );
    assert.throws(
      () => readNewClaim({ ...claim, lines: [{ code: 'A0427', units: 1 }] }),
      /Line 1 \(A0427\) has not been priced/
    );
  });
});
