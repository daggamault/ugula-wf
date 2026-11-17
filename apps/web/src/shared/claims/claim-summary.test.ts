import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { render, screen, within } from '../testing-dom.ts';
import type { ClaimDetail } from './claim-detail.ts';
import { ClaimSummaryPanel, ReasonsPanel } from './claim-summary.tsx';
import { claimDetail } from './testing.ts';

const details = (claim: ClaimDetail) => {
  render(createElement(ClaimSummaryPanel, { claim }));
  return within(screen.getByRole('region', { name: 'Summary' }))
    .getAllByRole('term')
    .map((t) => [t.textContent, t.nextElementSibling?.textContent]);
};

describe('ClaimSummaryPanel', () => {
  it('shows the total and what the workflow decided', () => {
    assert.deepEqual(details(claimDetail), [
      ['Total', '$1,142.20'],
      ['Classification', 'Emergency Transport'],
      ['Level of Service', 'ALS1 emergency'],
      ['Loaded Miles', '12.4 miles']
    ]);
  });

  it('shows the level alone for a non-emergency, and a dash without loaded miles', () => {
    assert.deepEqual(
      details({ ...claimDetail, is_emergency: false, loaded_miles: null }).slice(2),
      [
        ['Level of Service', 'ALS1'],
        ['Loaded Miles', '—']
      ]
    );
  });
});

describe('ReasonsPanel', () => {
  it('lists why the claim was built this way', () => {
    render(createElement(ReasonsPanel, { reasons: claimDetail.reasons }));
    assert.deepEqual(
      within(screen.getByRole('region', { name: 'Reasons' }))
        .getAllByRole('listitem')
        .map((li) => li.textContent),
      ['Emergency response', 'ALS assessment performed']
    );
  });

  it('says when there are no reasons', () => {
    render(createElement(ReasonsPanel, { reasons: [] }));
    assert.ok(screen.getByText('The workflow gave no reasons for this claim.'));
  });
});
