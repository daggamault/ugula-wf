import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { render, screen, within } from '../testing-dom.ts';
import type { ClaimDetail } from './claim-detail.ts';
import { ClaimSummaryPanel, pricedLinesOf } from './claim-summary.tsx';
import { claimDetail } from './testing.ts';

describe('pricedLinesOf', () => {
  it('turns stored claim lines into priced lines, in order', () => {
    assert.deepEqual(
      pricedLinesOf([
        { position: 1, code: 'A0427', units: 1, unit_cents: 95_000, total_cents: 95_000 },
        { position: 2, code: 'A0425', units: 6.8, unit_cents: 1_200, total_cents: 8_160 }
      ]),
      [
        { code: 'A0427', units: 1, unitCents: 95_000, totalCents: 95_000 },
        { code: 'A0425', units: 6.8, unitCents: 1_200, totalCents: 8_160 }
      ]
    );
  });
});

const details = (claim: ClaimDetail) => {
  render(createElement(ClaimSummaryPanel, { claim }));
  return within(screen.getByRole('region', { name: 'Summary' }))
    .getAllByRole('term')
    .map((t) => [t.textContent, t.nextElementSibling?.textContent]);
};

describe('ClaimSummaryPanel', () => {
  it('shows what was billed, the patient and the transport', () => {
    assert.deepEqual(details(claimDetail), [
      ['Total', '$1,142.20'],
      ['Service Date', 'Oct 1, 2026'],
      ['Born', 'Apr 12, 1958'],
      ['Classification', 'Emergency Transport'],
      ['Transport', 'ALS1 emergency · 12.4 miles loaded'],
      ['Responsible Facility', 'None: the payers and the patient']
    ]);
  });

  it('names the facility responsible for the claim', () => {
    assert.equal(
      details({ ...claimDetail, facility_id: 'f1', facility_name: 'St. Mary' }).at(-1)?.[1],
      'St. Mary'
    );
  });

  it('shows the level alone for a non-emergency without loaded miles', () => {
    assert.equal(
      details({ ...claimDetail, is_emergency: false, loaded_miles: null })[4]?.[1],
      'ALS1'
    );
  });

  it('shows a dash for a missing classification, level or birth date', () => {
    assert.deepEqual(
      details({
        ...claimDetail,
        classification: null,
        level: null,
        is_emergency: false,
        loaded_miles: null,
        birth_date: null
      }).slice(2, 5),
      [
        ['Born', '—'],
        ['Classification', '—'],
        ['Transport', '—']
      ]
    );
  });
});
