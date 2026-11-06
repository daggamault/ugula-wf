import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ClaimCoverage } from './claim-detail.ts';
import {
  abnText,
  authorizationText,
  conditionsText,
  DocumentationPanel,
  EligibilityPanel,
  eligibilityStyle,
  milesText,
  mspText,
  pcsText,
  stayText,
  weightText
} from './claim-documentation.tsx';

const documented = {
  signature: 'exception' as const,
  signature_note: 'Not signed because the patient was unconscious',
  pcs_on_file: true,
  pcs_signed_on: '2026-09-20',
  transport_reason: 'A' as const,
  condition_codes: ['06', '09'],
  prior_authorization: 'PA-1',
  weight_kg: '81.6',
  at_scene_at: '2026-10-01T10:05:00Z',
  left_scene_at: null,
  at_destination_at: null,
  patient_count: 2,
  closest_facility_miles: '4.6',
  abn_on_file: true,
  abn_signed_on: '2026-09-30',
  denial_expected: true,
  msp_employer_plan: false,
  msp_esrd: false,
  msp_disability: false,
  msp_accident: 'none' as const,
  prior_authorization_expires_on: '2026-12-01',
  pcs_type: 'repetitive' as const,
  round_trips: 4,
  admission_date: null,
  facility_stay: null,
  deceased: false,
  non_covered_miles: '2.4'
};

const coverage: ClaimCoverage = {
  id: 'cov-m',
  position: 1,
  payer: 'Medicare',
  payer_id: 'p-m',
  payer_code: null,
  member_id: '1EG4',
  group_id: null,
  relationship: '18',
  insured_first_name: null,
  insured_last_name: null,
  eligibility: 'inactive',
  eligibility_note: 'Not covered after 2026-09-30',
  eligibility_checked_at: '2026-10-31T12:00:00Z',
  stay_kind: null,
  stay_admitted_on: null,
  stay_discharged_on: null
};

describe('claim documentation', () => {
  it('describes certification, weight and conditions in words', () => {
    assert.match(pcsText(documented), /^On file, signed /);
    assert.equal(pcsText({ pcs_on_file: false, pcs_signed_on: null }), 'Not on file');
    assert.equal(pcsText({ pcs_on_file: null, pcs_signed_on: null }), 'Not recorded');
    assert.equal(weightText('81.6'), '81.6 kg (180 lb)');
    assert.equal(weightText(null), null);
    assert.equal(
      conditionsText(['06', 'ZZ']),
      '06 · Patient was transported in an emergency situation; ZZ'
    );
  });

  it('describes the MSP answers, ABN, authorization, stay and miles', () => {
    assert.equal(mspText(documented), 'Medicare pays first');
    assert.equal(
      mspText({ ...documented, msp_accident: 'workersComp', msp_esrd: true }),
      "Medicare pays second: Workers' compensation; End-stage renal disease"
    );
    assert.equal(mspText({ ...documented, msp_esrd: null }), 'Not answered');
    assert.match(abnText(documented), /^On file, signed .+ \(GA\)$/);
    assert.equal(
      abnText({ ...documented, abn_on_file: null }),
      'Not recorded, and Medicare is expected to deny (GZ)'
    );
    assert.equal(
      abnText({ ...documented, abn_on_file: false, denial_expected: false }),
      'Not on file'
    );
    assert.match(authorizationText(documented) ?? '', /^PA-1, expires .+ · round trip 4$/);
    assert.equal(
      authorizationText({ ...documented, prior_authorization: null, round_trips: null }),
      null
    );
    assert.match(
      stayText({ facility_stay: 'snf', admission_date: '2026-09-29' }) ?? '',
      /^Skilled nursing facility stay \(Part A\), admitted /
    );
    assert.equal(stayText(documented), null);
    assert.equal(
      milesText(documented),
      '4.6 mi to the closest hospital, 2.4 mi non-covered (A0888)'
    );
    assert.match(milesText({ ...documented, deceased: true }) ?? '', /QL, no mileage/);
  });

  it('shows the signature with why, and every documented field', () => {
    const html = renderToStaticMarkup(createElement(DocumentationPanel, { claim: documented }));
    assert.ok(html.includes('Not signed, with a documented reason the patient could not sign'));
    assert.ok(html.includes('the patient was unconscious') && html.includes('PA-1'));
    assert.ok(html.includes('A · Nearest facility'));
    assert.ok(html.includes('81.6 kg (180 lb)') && html.includes('06 · Patient was transported'));
    assert.ok(html.includes('text-warning'));
  });

  it('shows an empty value for anything the report left out', () => {
    const html = renderToStaticMarkup(
      createElement(DocumentationPanel, {
        claim: {
          ...documented,
          signature: 'missing',
          signature_note: null,
          pcs_on_file: null,
          transport_reason: null,
          condition_codes: [],
          prior_authorization: null,
          prior_authorization_expires_on: null,
          round_trips: null,
          patient_count: null,
          closest_facility_miles: null,
          non_covered_miles: null,
          weight_kg: null
        }
      })
    );
    assert.ok(html.includes('text-danger') && html.includes('Not recorded'));
    for (const label of [
      'Transport Reason',
      'Ambulance Conditions',
      'Prior Authorization',
      'Facility Stay',
      'Patients Transported',
      'Mileage',
      'Weight'
    ]) {
      assert.match(html, new RegExp(`${label}</dt><dd[^>]*>—</dd>`));
    }
  });

  it('lists each payer with its eligibility and offers its 270 to download', () => {
    assert.deepEqual(eligibilityStyle(coverage), { intent: 'danger', label: 'Not Active' });
    assert.equal(eligibilityStyle({ eligibility: null }).label, 'Not Checked');
    assert.deepEqual(eligibilityStyle({ eligibility: 'active' }), {
      intent: 'success',
      label: 'Active'
    });
    const html = renderToStaticMarkup(
      createElement(EligibilityPanel, { coverages: [coverage], onDownload: async () => undefined })
    );
    assert.ok(!html.includes('Check Eligibility') && html.includes('Not covered after 2026-09-30'));
    assert.ok(html.includes('Download 270'));
    const empty = renderToStaticMarkup(
      createElement(EligibilityPanel, { coverages: [], onDownload: async () => undefined })
    );
    assert.ok(empty.includes('No payer is on this claim.') && empty.includes('disabled'));
  });
});
