import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CLAIM_FIX_FIELDS, COVERAGE_FIELDS } from './claim-fix-fields.ts';
import { fixForm } from './claim-fix-form.ts';
import type { ClaimIssue } from './claim-validation.ts';
import { completeCheck } from './testing.ts';

const issue = (code: string, field: ClaimIssue['field'], coverageId: string | null = null) => ({
  code,
  severity: 'blocking' as const,
  field,
  message: code,
  coverageId
});

const check = completeCheck();

const directory = [{ id: 'p-Medicare', name: 'Medicare', claimFiling: 'MB' }];
describe('fixForm', () => {
  it('asks only the fields the issues are fixed in, prefilled with the claim as it is', () => {
    const broken = {
      ...check,
      details: { ...check.details, serviceDate: null, originDestination: null },
      payers: [{ ...check.payers[1], memberId: null } as (typeof check.payers)[number]]
    };
    const issues = [
      issue('service-date-missing', 'serviceDate'),
      issue('origin-destination-missing', 'originDestination'),
      issue('member-id-missing', 'memberId', 'cov-Blue')
    ];
    const form = fixForm(broken, issues, directory, false);
    assert.deepEqual(form.visible, [
      'serviceDate',
      'originCode',
      'destinationCode',
      'coverageId',
      'payerId',
      'memberId',
      'relationship',
      'insuredFirstName',
      'insuredLastName',
      'removeCoverage',
      'note'
    ]);
    assert.deepEqual(
      [form.defaults.coverageId, form.defaults.memberId, form.defaults.originCode],
      ['cov-Blue', null, null]
    );
    assert.deepEqual(
      fixForm(check, [issue('abn-missing', 'abn'), issue('msp-unanswered', 'msp')], [], false)
        .visible,
      [
        'abnOnFile',
        'abnSignedOn',
        'denialExpected',
        'mspEmployerPlan',
        'mspEsrd',
        'mspDisability',
        'mspEmployerSize',
        'mspAccident',
        'note'
      ]
    );
    assert.deepEqual(form.options.coverageId, [{ value: 'cov-Blue', label: 'Blue' }]);
    assert.deepEqual(form.options.payerId, [
      { value: 'p-Medicare', label: 'Medicare (Medicare Part B)' }
    ]);
  });

  it('offers every field on request, leaving out payer fields with no payers or directory', () => {
    const names = CLAIM_FIX_FIELDS.map((f) => f.name);
    const form = fixForm({ ...check, payers: [] }, [], directory, true);
    assert.deepEqual(
      form.visible,
      names.filter((n) => !COVERAGE_FIELDS.includes(n))
    );
    assert.deepEqual(Object.keys(form.options), ['payerId']);
    assert.deepEqual(
      fixForm(check, [], [], true).visible,
      names.filter((n) => n !== 'payerId')
    );
    assert.deepEqual(fixForm(check, [], [], false).visible, ['note']);
  });

  it('prefills every field with the claim as it is', () => {
    const d = check.details.documentation;
    assert.deepEqual(fixForm(check, [], [], true).defaults, {
      serviceDate: '2025-12-30',
      classification: 'emergency',
      level: 'ALS1',
      emergency: true,
      loadedMiles: 7.3,
      deceased: false,
      nonCoveredMiles: null,
      diagnoses: ['R079'],
      pickupAddressLine: '9 Oak Ave',
      pickupCity: 'Springfield',
      pickupState: 'IL',
      pickupPostalCode: '62702',
      destinationName: 'Mercy',
      destinationAddressLine: '9 Oak Ave',
      destinationCity: 'Springfield',
      destinationState: 'IL',
      destinationPostalCode: '62702',
      originCode: 'R',
      destinationCode: 'H',
      transportReason: 'A',
      signature: 'signed',
      pcsOnFile: null,
      pcsSignedOn: null,
      patientCount: d.patientCount,
      abnOnFile: d.abnOnFile,
      abnSignedOn: d.abnSignedOn,
      denialExpected: d.denialExpected,
      mspEmployerPlan: d.mspEmployerPlan,
      mspEsrd: d.mspEsrd,
      mspDisability: d.mspDisability,
      mspEmployerSize: d.mspEmployerSize,
      mspAccident: d.mspAccident,
      priorAuthorization: d.priorAuthorization,
      priorAuthorizationExpiresOn: d.priorAuthorizationExpiresOn,
      pcsType: d.pcsType,
      roundTrips: d.roundTrips,
      admissionDate: d.admissionDate,
      facilityStay: d.facilityStay,
      patientAddressLine: '9 Oak Ave',
      patientCity: 'Springfield',
      patientState: 'IL',
      patientPostalCode: '62702',
      coverageId: 'cov-Medicare',
      payerId: 'p-Medicare',
      memberId: 'M-Medicare',
      relationship: '18',
      insuredFirstName: null,
      insuredLastName: null,
      removeCoverage: false
    });
  });

  it('prefills no payer details when the issue names a coverage the claim lacks', () => {
    const form = fixForm(check, [issue('member-id-missing', 'memberId', 'cov-Gone')], [], false);
    assert.deepEqual(
      [form.defaults.coverageId, form.defaults.payerId, form.defaults.memberId],
      ['cov-Gone', null, null]
    );
  });

  it('prefills no classification for a trip not billable, and no patient address without a patient', () => {
    const form = fixForm(
      { ...check, classification: 'notBillable', patient: null },
      [issue('classification-missing', 'classification')],
      [],
      false
    );
    assert.equal(form.defaults.classification, null);
    assert.equal(Object.hasOwn(form.defaults, 'patientCity'), false);
    assert.equal(fixForm(check, [], [], true).defaults.patientCity, 'Springfield');
  });

  it("labels each payer with its member ID and the first payer's details by default", () => {
    const form = fixForm(
      {
        ...check,
        payers: [
          ...check.payers,
          { ...(check.payers[0] as (typeof check.payers)[number]), coverageId: null }
        ]
      },
      [],
      [],
      true
    );
    assert.deepEqual(form.options.coverageId, [
      { value: 'cov-Medicare', label: 'Medicare · M-Medicare' },
      { value: 'cov-Blue', label: 'Blue · M-Blue' }
    ]);
    assert.deepEqual(
      [form.defaults.coverageId, form.defaults.payerId, form.defaults.memberId],
      ['cov-Medicare', 'p-Medicare', 'M-Medicare']
    );
  });
});
