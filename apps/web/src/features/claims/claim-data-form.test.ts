import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ClaimDataForm } from './claim-data-form.tsx';
import type { ClaimDetail } from './client.ts';

const claim = {
  id: 'c1',
  coverages: [
    { id: 'cov-m', payer: 'Medicare', member_id: '1EG4', group_id: null },
    { id: 'cov-b', payer: 'Blue Plan', member_id: null, group_id: null }
  ],
  service_date: '2026-10-01',
  pickup_address_line: '9 Elm St',
  pickup_city: null,
  pickup_state: 'IL',
  pickup_postal_code: '62704',
  destination_name: 'St. Mary',
  destination_address_line: null,
  destination_city: null,
  destination_state: null,
  destination_postal_code: null,
  diagnoses: ['R079', 'I10'],
  origin_code: 'S',
  destination_code: 'H',
  address_line: '1 Main St',
  city: null,
  state: 'IL',
  postal_code: '62704',
  signature: 'missing',
  transport_reason: null,
  pcs_on_file: null,
  pcs_signed_on: null,
  patient_count: null,
  closest_facility_miles: null,
  abn_on_file: null,
  abn_signed_on: null,
  denial_expected: null,
  msp_employer_plan: null,
  msp_esrd: null,
  msp_disability: null,
  msp_accident: null,
  prior_authorization: null,
  prior_authorization_expires_on: null,
  pcs_type: null,
  round_trips: null,
  admission_date: null,
  facility_stay: null
} as unknown as ClaimDetail;

describe('ClaimDataForm', () => {
  it('renders labelled inputs for every payer and location', () => {
    const html = renderToStaticMarkup(
      createElement(ClaimDataForm, { claim, locked: undefined, onSave: async () => true })
    );
    assert.ok(html.includes('for="coverage-1-memberId"'));
    assert.ok(html.includes('>Blue Plan<'));
    assert.ok(html.includes('for="destination-name"'));
    assert.ok(html.includes('type="date"'));
    assert.ok(html.includes('>Save Claim Data<'));
    assert.ok(html.includes('for="origin-code"'));
    assert.ok(html.includes('S · Scene of an accident or acute event'));
    assert.ok(html.includes('Diagnosis Codes (ICD-10-CM)') && html.includes('ZIP Code'));
    assert.ok(!html.includes('<fieldset disabled=""'));
  });

  it('disables every field and says why while the claim is locked', () => {
    const html = renderToStaticMarkup(
      createElement(ClaimDataForm, {
        claim,
        locked: 'This claim is closed.',
        onSave: async () => true
      })
    );
    assert.ok(html.includes('<fieldset disabled=""') && html.includes('This claim is closed.'));
  });
});
