import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ClaimCheck } from '@ugula/billing';
import { completeCheck } from '@ugula/billing/testing';
import { createElement } from 'react';
import { formatDate } from '../../shared/format.ts';
import { render, screen, within } from '../../shared/testing-dom.ts';
import { ClaimCheckView, isClaimCheck } from './claim-check.tsx';

const show = (claim: ClaimCheck) => render(createElement(ClaimCheckView, { claim }));

const details = () =>
  Object.fromEntries(
    [...document.querySelectorAll('dt')].map((dt) => [
      dt.textContent,
      dt.nextElementSibling?.textContent
    ])
  );

const rowsOf = (name: string) =>
  within(screen.getByRole('table', { name }))
    .getAllByRole('row')
    .slice(1)
    .map((row) =>
      within(row)
        .getAllByRole('cell')
        .map((c) => c.lastElementChild?.textContent)
    );

describe('isClaimCheck', () => {
  it('recognizes a claim check by its lines, payers and details', () => {
    assert.equal(isClaimCheck({ lines: [], payers: [], details: {} }), true);
  });

  it('refuses anything missing one of them', () => {
    assert.equal(isClaimCheck({ trip: {} }), false);
    assert.equal(isClaimCheck({ lines: [], payers: [], details: null }), false);
    assert.equal(isClaimCheck({ lines: [], payers: {}, details: {} }), false);
    assert.equal(isClaimCheck({ lines: 'A0427', payers: [], details: {} }), false);
    assert.equal(isClaimCheck(null), false);
    assert.equal(isClaimCheck(undefined), false);
  });
});

describe('ClaimCheckView', () => {
  it('lists the claim details with money, miles, level and places', () => {
    show(completeCheck(['Medicare']));
    assert.deepEqual(details(), {
      Total: '$1,000.00',
      'Date of Service': formatDate('2025-12-30'),
      Classification: 'Emergency Transport',
      'Level of Service': 'ALS1, emergency',
      'Loaded Miles': '7.3 miles',
      Diagnoses: 'R079',
      'PCR Number': 'PCR-1',
      'Origin/Destination': 'RH',
      'Patient Address': '9 Oak Ave, Springfield, IL 62702',
      Pickup: '9 Oak Ave, Springfield, IL 62702',
      Destination: 'Mercy, 9 Oak Ave, Springfield, IL 62702'
    });
  });

  it('lists the charge lines', () => {
    show(completeCheck(['Medicare']));
    assert.deepEqual(rowsOf('Claim lines'), [
      ['A0427', '1', '$927.00', '$927.00'],
      ['A0425', '7.3', '$10.00', '$73.00']
    ]);
  });

  it('lists the payers with their member, relationship and insured', () => {
    const claim = completeCheck(['Medicare', 'Blue']);
    const [medicare, blue] = claim.payers;
    assert.ok(medicare && blue);
    show({
      ...claim,
      payers: [
        medicare,
        {
          ...blue,
          memberId: null,
          relationship: '01',
          insuredFirstName: 'Sam',
          insuredLastName: 'Doe'
        }
      ]
    });
    assert.deepEqual(rowsOf('Payers on the claim'), [
      ['Medicare', 'M-Medicare', 'Self', 'The patient'],
      ['Blue', '—', 'Spouse', 'Sam Doe']
    ]);
  });

  it('shows a relationship code it has no label for as is', () => {
    const claim = completeCheck(['Medicare']);
    show({
      ...claim,
      payers: claim.payers.map((p) => ({ ...p, relationship: 'ZZ' }))
    } as ClaimCheck);
    assert.deepEqual(rowsOf('Payers on the claim'), [
      ['Medicare', 'M-Medicare', 'ZZ', 'The patient']
    ]);
  });

  it('says when a claim has no charges or payers', () => {
    show({ ...completeCheck([]), lines: [] });
    assert.ok(screen.getByText('No charge lines.'));
    assert.ok(screen.getByText('No payers, so the patient is billed.'));
    assert.ok(!screen.queryByRole('table'));
  });

  it('shows unknown values as a dash and an unknown classification as is', () => {
    const claim = completeCheck([]);
    show({
      ...claim,
      classification: 'custom',
      emergency: false,
      loadedMiles: null,
      level: null,
      pcrNumber: null,
      patient: null,
      details: {
        ...claim.details,
        serviceDate: null,
        diagnoses: [],
        originDestination: null,
        pickup: null,
        destination: null
      }
    } as unknown as ClaimCheck);
    assert.deepEqual(details(), {
      Total: '$1,000.00',
      'Date of Service': '—',
      Classification: 'custom',
      'Level of Service': '—, non-emergency',
      'Loaded Miles': '—',
      Diagnoses: '—',
      'PCR Number': '—',
      'Origin/Destination': '—',
      'Patient Address': '—',
      Pickup: '—',
      Destination: '—'
    });
  });

  it('leaves out the emergency when it is not known', () => {
    show({ ...completeCheck([]), classification: null, emergency: null } as unknown as ClaimCheck);
    assert.equal(details().Classification, '—');
    assert.equal(details()['Level of Service'], 'ALS1');
  });
});
