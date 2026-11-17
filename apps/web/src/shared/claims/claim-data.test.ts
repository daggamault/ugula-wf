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

  it('shows an unknown code bare', () => {
    assert.deepEqual(modifierCode('Q'), { text: 'Q', code: null });
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
  it('shows the service date, diagnoses, pickup and destination types and addresses', () => {
    show({ origin_code: 'R', destination_code: 'H', destination_city: 'Springfield' });
    assert.deepEqual(details(), [
      ['Date of Service', 'Oct 1, 2026'],
      ['Diagnosis Codes', 'Chest pain R07.9I10'],
      ['Pickup Type', 'Residence R'],
      ['Destination Type', 'Hospital H'],
      ['Patient Mailing Address', '1 Main St, Springfield, IL 62704'],
      ['Pickup', '9 Elm St, IL 62704'],
      ['Destination', 'St. Mary, Springfield']
    ]);
  });

  it('lists the diagnoses in order', () => {
    show();
    assert.deepEqual(
      within(screen.getByRole('list'))
        .getAllByRole('listitem')
        .map((li) => li.textContent),
      ['Chest pain R07.9', 'I10']
    );
  });

  it('shows a dash for each value the claim lacks', () => {
    show({
      diagnoses: [],
      address_line: null,
      city: null,
      state: null,
      postal_code: null,
      pickup_address_line: null,
      pickup_state: null,
      pickup_postal_code: null,
      destination_name: null
    });
    assert.deepEqual(details().slice(1), [
      ['Diagnosis Codes', '—'],
      ['Pickup Type', '—'],
      ['Destination Type', '—'],
      ['Patient Mailing Address', '—'],
      ['Pickup', '—'],
      ['Destination', '—']
    ]);
    assert.ok(!screen.queryByRole('list'));
  });
});
