import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { render, screen, within } from '../testing-dom.ts';
import { addressText, ClaimDataView, modifierText } from './claim-data.tsx';
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

describe('modifierText', () => {
  it('names an origin or destination code', () => {
    assert.equal(modifierText('R'), 'Residence (R)');
  });

  it('shows an unknown code bare', () => {
    assert.equal(modifierText('Q'), 'Q');
  });

  it('is null without a code', () => {
    assert.equal(modifierText(null), null);
  });
});

const show = (claim: Partial<ClaimDetail> = {}, placeOfService?: string | null) =>
  render(
    createElement(ClaimDataView, {
      claim: { ...claimDetail, ...claim },
      codes: { icd10cm: { R079: 'Chest pain' }, pos: { '41': 'Ambulance - Land' } },
      placeOfService
    })
  );

const details = () =>
  within(screen.getByRole('region', { name: 'Claim Data' }))
    .getAllByRole('term')
    .map((t) => [t.textContent, t.nextElementSibling?.textContent]);

describe('ClaimDataView', () => {
  it('says how to change the data it shows', () => {
    show();
    assert.ok(
      within(screen.getByRole('region', { name: 'Claim Data' })).getByText(
        'Change it with the Correct Claim Data task.'
      )
    );
  });

  it('shows the service date, diagnoses, pickup and destination types and addresses', () => {
    show({ origin_code: 'R', destination_code: 'H', destination_city: 'Springfield' }, '41');
    assert.deepEqual(details(), [
      ['Date of Service', 'Oct 1, 2026'],
      ['Place of Service', 'Ambulance - Land (41)'],
      ['Diagnosis Codes', 'Chest pain (R07.9)I10'],
      ['Pickup Type', 'Residence (R)'],
      ['Destination Type', 'Hospital (H)'],
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
      ['Chest pain (R07.9)', 'I10']
    );
  });

  it('leaves out the place of service when there is none', () => {
    show({}, null);
    assert.equal(
      details().some(([label]) => label === 'Place of Service'),
      false
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
