import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CLAIM_FIX_FIELDS } from './claim-fix-fields.ts';
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
    assert.equal(form.defaults.coverageId, 'cov-Blue');
    assert.equal(form.defaults.pickupPostalCode, '62702');
    assert.equal(form.defaults.deceased, false);
    assert.equal(form.defaults.mspAccident, null);
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
    const form = fixForm({ ...check, payers: [] }, [], [], true);
    assert.ok(form.visible.includes('loadedMiles') && form.visible.includes('patientCity'));
    assert.ok(!form.visible.includes('coverageId') && !form.visible.includes('payerId'));
    assert.deepEqual(form.options, {});
    assert.equal(CLAIM_FIX_FIELDS.find((f) => f.name === 'serviceDate')?.format, 'date');
  });
});
