import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CLAIM_FIX_FIELDS, chargeChanges, fixForm, readClaimPatch } from './claim-fix.ts';
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
    assert.equal(form.defaults.coverageId, 'cov-Blue');
    assert.equal(form.defaults.pickupPostalCode, '62702');
    assert.deepEqual(form.options.coverageId, [{ value: 'cov-Blue', label: 'Blue' }]);
    assert.deepEqual(form.options.payerId, [
      { value: 'p-Medicare', label: 'Medicare (Medicare Part B)' }
    ]);
  });

  it('offers every field on request, leaving out payer fields with no payers or directory', () => {
    const form = fixForm({ ...check, payers: [] }, [], [], true);
    assert.ok(form.visible.includes('loadedMiles') && form.visible.includes('patientCity'));
    assert.ok(!form.visible.includes('coverageId') && !form.visible.includes('payerId'));
    assert.deepEqual(form.options, {});
    assert.equal(CLAIM_FIX_FIELDS.find((f) => f.name === 'serviceDate')?.format, 'date');
  });
});

describe('readClaimPatch', () => {
  it('keeps what the biller left empty and merges partial addresses', () => {
    assert.ok(Object.values(readClaimPatch({}, check)).every((v) => v === null));
    const patch = readClaimPatch(
      {
        serviceDate: '2025-12-29',
        diagnoses: ['r07.9', 'bad'],
        destinationPostalCode: '62704',
        originCode: 'S',
        loadedMiles: 9.2,
        tripType: 'noClaim',
        coverageId: 'cov-Blue',
        memberId: ' B2 ',
        relationship: '19'
      },
      check
    );
    assert.equal(patch.serviceDate, '2025-12-29');
    assert.deepEqual(patch.diagnoses, ['R079']);
    assert.deepEqual(patch.destination, { ...check.details.destination, postalCode: '62704' });
    assert.equal(patch.pickup, null);
    assert.equal(patch.originDestination, 'SH');
    assert.equal(patch.tripType, null);
    assert.deepEqual(patch.coverage, {
      coverageId: 'cov-Blue',
      payerId: null,
      memberId: 'B2',
      relationship: '19',
      insuredFirstName: null,
      insuredLastName: null,
      remove: false
    });
    assert.ok(Object.values(chargeChanges(patch)).some(Boolean));
    assert.deepEqual(chargeChanges({ ...patch, loadedMiles: null, coverage: null }), {
      tripType: false,
      level: false,
      emergency: false,
      loadedMiles: false,
      payers: false
    });
  });

  it('ignores coverages that are not on the claim and invalid modifiers', () => {
    const patch = readClaimPatch({ coverageId: 'cov-Gone', memberId: 'X', originCode: 'X' }, check);
    assert.equal(patch.coverage, null);
    assert.equal(patch.originDestination, null);
    assert.equal(
      readClaimPatch({ coverageId: 'cov-Blue', removeCoverage: true }, check).coverage?.remove,
      true
    );
  });

  it('adds the payer a biller confirms for a claim without any', () => {
    const added = readClaimPatch(
      { payerId: 'p-Medicare', memberId: 'M9' },
      { ...check, payers: [] }
    );
    assert.deepEqual(added.newCoverage, {
      payerId: 'p-Medicare',
      memberId: 'M9',
      relationship: '18',
      insuredFirstName: null,
      insuredLastName: null
    });
    assert.equal(chargeChanges(added).payers, true);
    assert.equal(readClaimPatch({ payerId: 'p-Medicare' }, check).newCoverage, null);
  });
});
