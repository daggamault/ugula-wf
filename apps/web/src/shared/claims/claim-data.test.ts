import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { render, screen, within } from '../testing-dom.ts';
import { addressText, ClaimDataView, modifierCode } from './claim-data.tsx';
import type { ClaimDetail } from './claim-detail.ts';
import { claimDetail } from './testing.ts';

describe('addressText', () => {
  it('writes an address on one line', () => {
    assert.equal(
      addressText({
        addressLine: '1 Main St',
        city: 'Springfield',
        state: 'IL',
        postalCode: '62704'
      }),
      '1 Main St, Springfield, IL 62704'
    );
  });

  it('leads with the name of the place', () => {
    assert.equal(
      addressText({
        name: 'General',
        addressLine: '2 Elm',
        city: 'Town',
        state: 'VT',
        postalCode: '05401'
      }),
      'General, 2 Elm, Town, VT 05401'
    );
  });

  it('leaves out what is missing', () => {
    assert.equal(
      addressText({ addressLine: null, city: null, state: 'IL', postalCode: null }),
      'IL'
    );
    assert.equal(
      addressText({ addressLine: null, city: 'Town', state: null, postalCode: '05401' }),
      'Town, 05401'
    );
  });

  it('is null for an empty or missing place', () => {
    assert.equal(
      addressText({ name: null, addressLine: null, city: null, state: null, postalCode: null }),
      null
    );
    assert.equal(addressText(null), null);
  });
});

describe('modifierCode', () => {
  it('names an origin or destination code', () => {
    assert.deepEqual(modifierCode('R'), { text: 'Residence', code: 'R' });
  });

  it('names an origin and destination pair', () => {
    assert.deepEqual(modifierCode('RH'), { text: 'Residence to Hospital', code: 'RH' });
  });

  it('shows an unknown code bare', () => {
    assert.deepEqual(modifierCode('Q'), { text: 'Q', code: null });
    assert.deepEqual(modifierCode('QL'), { text: 'QL', code: null });
  });
});

const show = (claim: Partial<ClaimDetail> = {}) =>
  render(
    createElement(ClaimDataView, {
      claim: { ...claimDetail, ...claim },
      codes: { icd10cm: { R079: 'Chest pain' } }
    })
  );

const details = () =>
  within(screen.getByRole('region', { name: 'Claim Data' }))
    .getAllByRole('term')
    .map((t) => [t.textContent, t.nextElementSibling?.textContent]);

describe('ClaimDataView', () => {
  it('shows the service date, diagnoses, modifiers, ambulance details and the patient', () => {
    show({ origin_code: 'R', destination_code: 'H' });
    assert.deepEqual(details(), [
      ['Date of Service', 'Oct 1, 2026'],
      ['Diagnosis Codes', 'Chest pain R07.9I10'],
      ['Origin Modifier', 'Residence R'],
      ['Destination Modifier', 'Hospital H'],
      ['Transport Reason', 'Nearest facility for care of symptoms or complaints A'],
      [
        'Condition Codes',
        'Patient was transported in an emergency situation 06Ambulance service was medically necessary 09'
      ],
      ['Patient Weight', '180 lb'],
      ['Patient Born', 'Apr 12, 1958'],
      ['Patient Mailing Address', '1 Main St, Springfield, IL 62704']
    ]);
  });

  it('lists the diagnoses and condition codes in order', () => {
    show({ condition_codes: ['09', '02'] });
    assert.deepEqual(
      screen.getAllByRole('list').map((l) =>
        within(l)
          .getAllByRole('listitem')
          .map((li) => li.textContent)
      ),
      [
        ['Chest pain R07.9', 'I10'],
        ['Ambulance service was medically necessary 09', '02']
      ]
    );
  });

  it('shows a dash for each value the claim lacks', () => {
    show({
      diagnoses: [],
      birth_date: null,
      address_line: null,
      city: null,
      state: null,
      postal_code: null,
      transport_reason: null,
      condition_codes: [],
      weight_pounds: null
    });
    assert.deepEqual(details().slice(1), [
      ['Diagnosis Codes', '—'],
      ['Origin Modifier', '—'],
      ['Destination Modifier', '—'],
      ['Transport Reason', '—'],
      ['Condition Codes', '—'],
      ['Patient Weight', '—'],
      ['Patient Born', '—'],
      ['Patient Mailing Address', '—']
    ]);
    assert.ok(!screen.queryByRole('list'));
  });
});
