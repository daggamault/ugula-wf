import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  conditionsText,
  DocumentationPanel,
  EligibilityPanel,
  eligibilityStyle,
  pcsText,
  weightText
} from './claim-documentation.tsx';
import type { ClaimCoverage } from './client.ts';

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
  at_destination_at: null
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
  eligibility_checked_at: '2026-10-31T12:00:00Z'
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

  it('shows the signature with why, and every documented field', () => {
    const html = renderToStaticMarkup(createElement(DocumentationPanel, { claim: documented }));
    assert.ok(html.includes('Not signed, with a documented reason the patient could not sign'));
    assert.ok(html.includes('the patient was unconscious') && html.includes('PA-1'));
    assert.ok(html.includes('A · Nearest facility'));
  });

  it('lists each payer with its eligibility and offers a check', () => {
    assert.deepEqual(eligibilityStyle(coverage), { intent: 'danger', label: 'Not Active' });
    assert.equal(eligibilityStyle({ eligibility: null }).label, 'Not Checked');
    const html = renderToStaticMarkup(
      createElement(EligibilityPanel, {
        coverages: [coverage],
        locked: undefined,
        onCheck: async () => undefined
      })
    );
    assert.ok(html.includes('Check Eligibility') && html.includes('Not covered after 2026-09-30'));
    const empty = renderToStaticMarkup(
      createElement(EligibilityPanel, {
        coverages: [],
        locked: undefined,
        onCheck: async () => undefined
      })
    );
    assert.ok(empty.includes('No payer is on this claim.') && empty.includes('disabled'));
  });
});
