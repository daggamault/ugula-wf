import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type ClaimCheck, claimIssues, isBlocking, readNewClaim } from './claim-validation.ts';
import { readDocumentation } from './documentation.ts';
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

const blank = { name: null, addressLine: null, city: null, state: null, postalCode: null };

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
  eligibilityNote: null
};

const check: ClaimCheck = {
  patientId: 'p1',
  patient: place,
  pcrNumber: 'PCR-1',
  tripType: 'emergency',
  level: 'ALS1',
  emergency: true,
  loadedMiles: 7.3,
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

const documented = (d: Partial<typeof COMPLETE_DOCUMENTATION>, c: Partial<ClaimCheck> = {}) =>
  fields({
    ...check,
    ...c,
    details: { ...check.details, documentation: { ...COMPLETE_DOCUMENTATION, ...d } }
  });

const fields = (c: ClaimCheck) => claimIssues(c).map((i) => `${i.level}:${i.field}`);

describe('claimIssues', () => {
  it('passes a complete claim', () => {
    assert.deepEqual(claimIssues(check), []);
  });

  it('names the field each blocking issue is fixed in, and the coverage it is about', () => {
    const issues = claimIssues({
      ...check,
      patient: { ...place, postalCode: null },
      details: {
        serviceDate: null,
        pickup: blank,
        destination: blank,
        diagnoses: [],
        originDestination: null,
        documentation: readDocumentation({})
      },
      loadedMiles: null,
      payers: [
        { ...medicare, relationship: '01' },
        { ...medicare, coverageId: 'cov-2', name: 'Blue Plan', payerId: null, memberId: null }
      ]
    });
    assert.deepEqual(
      [...new Set(issues.map((i) => i.field))],
      [
        'patientAddress',
        'serviceDate',
        'diagnoses',
        'pickup',
        'transportReason',
        'times',
        'destination',
        'originDestination',
        'loadedMiles',
        'signature',
        'insured',
        'payer',
        'memberId'
      ]
    );
    assert.ok(isBlocking(issues));
    assert.deepEqual(issues.at(-2), {
      level: 'blocking',
      field: 'payer',
      message: 'Blue Plan is not linked to the payer directory',
      coverageId: 'cov-2'
    });
    assert.ok(issues.some((i) => i.message === 'The pickup ZIP code is missing'));
  });

  it('blocks impossible charges and warns about unlikely ones', () => {
    assert.deepEqual(fields({ ...check, loadedMiles: 0 }), ['blocking:loadedMiles']);
    assert.deepEqual(fields({ ...check, loadedMiles: 900 }), ['blocking:loadedMiles']);
    assert.deepEqual(fields({ ...check, loadedMiles: 140 }), ['warning:loadedMiles']);
    assert.deepEqual(fields({ ...check, totalCents: 5 }), ['blocking:lines']);
    assert.deepEqual(fields({ ...check, lines: [], totalCents: 0 }), ['blocking:lines']);
    assert.deepEqual(fields({ ...check, tripType: 'noClaim' }), ['blocking:tripType']);
    assert.deepEqual(fields({ ...check, level: null, emergency: null }), [
      'blocking:level',
      'blocking:emergency'
    ]);
    assert.deepEqual(fields({ ...check, tripType: 'scheduled' }), ['warning:emergency']);
    assert.ok(!isBlocking(claimIssues({ ...check, loadedMiles: 140 })));
  });

  it('files trips without transport without miles, drop-off or modifiers', () => {
    assert.deepEqual(
      fields({
        ...check,
        tripType: 'refusal',
        details: { ...check.details, destination: blank, originDestination: null },
        loadedMiles: 2
      }),
      ['warning:loadedMiles']
    );
  });

  it('warns when no payer or PCR number is on the claim, and blocks a claim without a patient', () => {
    assert.deepEqual(fields({ ...check, payers: [], pcrNumber: null }), [
      'warning:pcrNumber',
      'warning:payers'
    ]);
    assert.deepEqual(fields({ ...check, patientId: null, patient: null }), ['blocking:patient']);
  });
});

describe('documentation checks', () => {
  it('blocks billing without a billing signature, and warns on a documented exception', () => {
    assert.deepEqual(documented({ signature: 'missing' }), ['blocking:signature']);
    assert.deepEqual(documented({ signature: 'refused' }), ['blocking:signature']);
    assert.deepEqual(
      documented({
        signature: 'exception',
        signatureNote: 'Not signed because the patient was unconscious'
      }),
      ['warning:signature']
    );
  });

  it('asks for a current physician certification on scheduled non-emergency trips', () => {
    const scheduled = { tripType: 'scheduled', emergency: false };
    assert.deepEqual(documented({}, scheduled), ['blocking:pcs']);
    assert.deepEqual(
      documented({}, { ...scheduled, payers: [{ ...medicare, claimFiling: 'CI' }] }),
      ['warning:pcs']
    );
    assert.deepEqual(documented({ pcsOnFile: true, pcsSignedOn: '2026-09-20' }, scheduled), []);
    assert.deepEqual(documented({ pcsOnFile: true, pcsSignedOn: '2026-06-01' }, scheduled), [
      'warning:pcs'
    ]);
    assert.deepEqual(documented({ pcsOnFile: true, pcsSignedOn: '2026-10-09' }, scheduled), [
      'warning:pcs'
    ]);
    assert.deepEqual(documented({ pcsOnFile: true }, scheduled), ['warning:pcs']);
  });

  it('needs a transport reason and ordered trip times on transports only', () => {
    assert.deepEqual(documented({ transportReason: null }), ['blocking:transportReason']);
    assert.deepEqual(documented({ leftScene: null }), ['warning:times']);
    assert.deepEqual(documented({ atDestination: '2025-12-30T10:10:00Z' }), ['warning:times']);
    assert.deepEqual(
      documented(
        { transportReason: null, leftScene: null },
        { tripType: 'refusal', loadedMiles: null }
      ),
      []
    );
  });
});

describe('eligibility', () => {
  it('blocks billing a payer that reports the coverage inactive, and trusts active or unchecked', () => {
    const inactive = claimIssues({
      ...check,
      payers: [
        { ...medicare, eligibility: 'inactive', eligibilityNote: 'Not covered after 2026-09-30' }
      ]
    });
    assert.deepEqual(
      inactive.map((i) => [i.level, i.field, i.coverageId]),
      [['blocking', 'payer', 'cov-1']]
    );
    assert.match(inactive[0]?.message ?? '', /not active \(Not covered after 2026-09-30\)/);
    assert.deepEqual(fields({ ...check, payers: [{ ...medicare, eligibility: 'active' }] }), []);
  });
});

describe('filing limits', () => {
  const on = (day: string) => new Date(`${day}T12:00:00Z`);

  it('warns as the filing limit nears and once it passes, from the payer or federal default', () => {
    assert.deepEqual(claimIssues(check, on('2027-08-01')), []);
    assert.deepEqual(
      claimIssues(check, on('2027-09-20')).map((i) => i.message),
      ['11 days are left to file with Medicare (365-day limit)']
    );
    assert.match(
      claimIssues(check, on('2027-10-11'))[0]?.message ?? '',
      /365-day filing limit for Medicare passed 10 days ago/
    );
    const commercial = { ...check, payers: [{ ...medicare, claimFiling: 'CI' }] };
    assert.deepEqual(claimIssues(commercial, on('2030-01-01')), []);
    assert.deepEqual(
      fields({ ...commercial, payers: [{ ...medicare, claimFiling: 'CI', filingLimitDays: 90 }] }),
      []
    );
    assert.equal(
      claimIssues(
        { ...commercial, payers: [{ ...medicare, claimFiling: 'CI', filingLimitDays: 90 }] },
        on('2026-12-20')
      )[0]?.field,
      'filing'
    );
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
  });

  it('faults on a claim the flow could never have built', () => {
    assert.throws(() => readNewClaim({ ...claim, patientId: '' }), /needs a patient/);
    assert.throws(() => readNewClaim({ ...claim, level: 'X' }), /level of service/);
    assert.throws(() => readNewClaim({ ...claim, lines: [{ code: 'A0427', units: 1 }] }), /priced/);
  });
});
