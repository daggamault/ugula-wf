import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { formatDateTime } from '../format.ts';
import { render, screen, within } from '../testing-dom.ts';
import {
  abnText,
  authorizationText,
  conditionsText,
  DocumentationPanel,
  milesText,
  mspText,
  pcsText,
  stayText,
  weightText
} from './claim-documentation.tsx';

const documented = {
  signature: 'exception' as const,
  signature_note: 'Not signed because the patient was unconscious',
  has_pcs: true,
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
  has_abn: true,
  abn_signed_on: '2026-09-30',
  is_denial_expected: true,
  has_msp_employer_plan: false,
  has_msp_esrd: false,
  has_msp_disability: false,
  msp_employer_size: null,
  msp_accident: 'none' as const,
  prior_authorization_expires_on: '2026-12-01',
  pcs_type: 'repetitive' as const,
  round_trips: 4,
  admitted_on: null,
  facility_stay: null,
  is_deceased: false,
  non_covered_miles: '2.4'
};

describe('pcsText', () => {
  it('says the certification is on file and when it was signed', () => {
    assert.equal(pcsText(documented), 'On file, signed Sep 20, 2026');
    assert.equal(pcsText({ has_pcs: true, pcs_signed_on: null }), 'On file');
  });

  it('tells a missing certification from an unrecorded one', () => {
    assert.equal(pcsText({ has_pcs: false, pcs_signed_on: null }), 'Not on file');
    assert.equal(pcsText({ has_pcs: null, pcs_signed_on: null }), 'Not recorded');
  });
});

describe('abnText', () => {
  it('says the notice is on file, when it was signed, with the GA modifier', () => {
    assert.equal(abnText(documented), 'On file, signed Sep 30, 2026 (GA)');
    assert.equal(abnText({ ...documented, abn_signed_on: null }), 'On file (GA)');
  });

  it('adds the GZ modifier when Medicare is expected to deny without a notice', () => {
    assert.equal(
      abnText({ ...documented, has_abn: null }),
      'Not recorded, and Medicare is expected to deny (GZ)'
    );
    assert.equal(
      abnText({ ...documented, has_abn: false }),
      'Not on file, and Medicare is expected to deny (GZ)'
    );
  });

  it('says only whether the notice is on file when no denial is expected', () => {
    assert.equal(
      abnText({ ...documented, has_abn: null, is_denial_expected: false }),
      'Not recorded'
    );
    assert.equal(
      abnText({ ...documented, has_abn: false, is_denial_expected: false }),
      'Not on file'
    );
  });
});

describe('mspText', () => {
  it('says Medicare pays first once every question is answered no', () => {
    assert.equal(mspText(documented), 'Medicare pays first');
  });

  it('is not answered while any question is open', () => {
    assert.equal(mspText({ ...documented, has_msp_esrd: null }), 'Not answered');
    assert.equal(mspText({ ...documented, msp_accident: null }), 'Not answered');
  });

  it('lists the accident and every reason Medicare pays second', () => {
    assert.equal(
      mspText({ ...documented, msp_accident: 'workersComp', has_msp_esrd: true }),
      "Medicare pays second: Workers' compensation; End-stage renal disease"
    );
  });

  it('counts an employer plan only from 20 employees', () => {
    assert.equal(
      mspText({ ...documented, has_msp_employer_plan: true, msp_employer_size: 19 }),
      'Medicare pays first'
    );
    assert.equal(
      mspText({ ...documented, has_msp_employer_plan: true, msp_employer_size: 20 }),
      'Medicare pays second: Employer group health plan (20 employees)'
    );
  });

  it('counts a disability plan only from 100 employees', () => {
    assert.equal(
      mspText({ ...documented, has_msp_disability: true, msp_employer_size: 99 }),
      'Medicare pays first'
    );
    assert.equal(
      mspText({ ...documented, has_msp_disability: true, msp_employer_size: 100 }),
      'Medicare pays second: Disability with a large group plan (100 employees)'
    );
  });
});

describe('authorizationText', () => {
  it('writes the authorization, when it expires and the round trip', () => {
    assert.equal(authorizationText(documented), 'PA-1, expires Dec 1, 2026 · round trip 4');
    assert.equal(
      authorizationText({ ...documented, prior_authorization_expires_on: null, round_trips: null }),
      'PA-1'
    );
    assert.equal(authorizationText({ ...documented, prior_authorization: null }), 'round trip 4');
  });

  it('is null with neither', () => {
    assert.equal(
      authorizationText({ ...documented, prior_authorization: null, round_trips: null }),
      null
    );
  });
});

describe('stayText', () => {
  it('names the stay and when the patient was admitted', () => {
    assert.equal(
      stayText({ facility_stay: 'snf', admitted_on: '2026-09-29' }),
      'Skilled nursing facility stay (Part A), admitted Sep 29, 2026'
    );
    assert.equal(
      stayText({ facility_stay: 'inpatient', admitted_on: null }),
      'Hospital inpatient stay (Part A)'
    );
  });

  it('is null with neither', () => {
    assert.equal(stayText(documented), null);
  });
});

describe('milesText', () => {
  it('writes the miles to the closest hospital and those not covered', () => {
    assert.equal(
      milesText(documented),
      '4.6 mi to the closest hospital, 2.4 mi non-covered (A0888)'
    );
    assert.equal(
      milesText({ ...documented, closest_facility_miles: null }),
      '2.4 mi non-covered (A0888)'
    );
  });

  it('bills no mileage for a patient pronounced dead before loading', () => {
    assert.equal(
      milesText({ ...documented, is_deceased: true }),
      'Pronounced dead before loading: BLS with QL, no mileage'
    );
  });

  it('is null with neither', () => {
    assert.equal(
      milesText({ ...documented, closest_facility_miles: null, non_covered_miles: null }),
      null
    );
  });
});

describe('weightText', () => {
  it('writes the weight in kilograms and pounds', () => {
    assert.equal(weightText('81.6'), '81.6 kg (180 lb)');
  });

  it('is null without a weight', () => {
    assert.equal(weightText(null), null);
  });
});

describe('conditionsText', () => {
  it('names each known condition code and keeps unknown ones bare', () => {
    assert.equal(
      conditionsText(['06', 'ZZ']),
      '06 · Patient was transported in an emergency situation; ZZ'
    );
  });
});

const details = (region: string) =>
  within(screen.getByRole('region', { name: region }))
    .getAllByRole('term')
    .map((t) => [t.textContent, t.nextElementSibling?.textContent]);

describe('DocumentationPanel', () => {
  it('shows the signature with why, and every documented field', () => {
    render(createElement(DocumentationPanel, { claim: documented }));
    assert.deepEqual(details('Documentation'), [
      [
        'Billing Signature',
        'Not signed, with a documented reason the patient could not signNot signed because the patient was unconscious'
      ],
      [
        'Physician Certification',
        'On file, signed Sep 20, 2026 · Repetitive scheduled transports (valid 60 days)'
      ],
      ['Medicare Secondary Payer', 'Medicare pays first'],
      ['Advance Beneficiary Notice', 'On file, signed Sep 30, 2026 (GA)'],
      ['Transport Reason', 'A · Nearest facility for care of symptoms or complaints'],
      [
        'Ambulance Conditions',
        '06 · Patient was transported in an emergency situation; 09 · Ambulance service was medically necessary'
      ],
      ['Prior Authorization', 'PA-1, expires Dec 1, 2026 · round trip 4'],
      ['Facility Stay', '—'],
      ['Patients Transported', '2'],
      ['Mileage', '4.6 mi to the closest hospital, 2.4 mi non-covered (A0888)'],
      ['Weight', '81.6 kg (180 lb)'],
      ['On Scene', formatDateTime('2026-10-01T10:05:00Z')],
      ['Left Scene', '—'],
      ['At Destination', '—']
    ]);
  });

  it('colors the signature by how far it can be billed', () => {
    const cases = [
      ['signed', 'bg-success/10'],
      ['exception', 'bg-warning/10'],
      ['refused', 'bg-danger/10'],
      ['missing', 'bg-danger/10']
    ] as const;
    for (const [signature, tint] of cases) {
      const { unmount } = render(
        createElement(DocumentationPanel, { claim: { ...documented, signature } })
      );
      const [signed] = screen.getAllByRole('definition');
      const badge = signed?.querySelector('.rounded-full');
      assert.equal(badge?.classList.contains(tint), true, signature);
      unmount();
    }
  });

  it('shows a dash for anything the report left out', () => {
    render(
      createElement(DocumentationPanel, {
        claim: {
          ...documented,
          signature: 'missing',
          signature_note: null,
          has_pcs: null,
          pcs_type: null,
          transport_reason: null,
          condition_codes: [],
          prior_authorization: null,
          prior_authorization_expires_on: null,
          round_trips: null,
          patient_count: null,
          closest_facility_miles: null,
          non_covered_miles: null,
          weight_kg: null,
          at_scene_at: null
        }
      })
    );
    assert.deepEqual(details('Documentation'), [
      ['Billing Signature', 'No billing signature'],
      ['Physician Certification', 'Not recorded'],
      ['Medicare Secondary Payer', 'Medicare pays first'],
      ['Advance Beneficiary Notice', 'On file, signed Sep 30, 2026 (GA)'],
      ['Transport Reason', '—'],
      ['Ambulance Conditions', '—'],
      ['Prior Authorization', '—'],
      ['Facility Stay', '—'],
      ['Patients Transported', '—'],
      ['Mileage', '—'],
      ['Weight', '—'],
      ['On Scene', '—'],
      ['Left Scene', '—'],
      ['At Destination', '—']
    ]);
  });
});
