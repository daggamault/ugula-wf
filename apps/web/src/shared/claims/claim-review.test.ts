import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { render, screen, within } from '../testing-dom.ts';
import type { ClaimDetail } from './claim-detail.ts';
import { ClaimReviewPanel } from './claim-review.tsx';
import { claimDetail } from './testing.ts';

const show = (claim: Partial<ClaimDetail>) =>
  render(createElement(ClaimReviewPanel, { claim: { ...claimDetail, ...claim } }));

const details = () =>
  within(screen.getByRole('region', { name: 'Review' }))
    .getAllByRole('term')
    .map((t) => [t.textContent, t.nextElementSibling?.textContent]);

describe('ClaimReviewPanel', () => {
  it('says a claim waits for a biller until it is reviewed', () => {
    show({ status: 'needs_review', revision: 2 });
    assert.deepEqual(details(), [
      ['Status', 'Needs Review'],
      ['Revision', '2'],
      ['Waiting For', 'A biller to approve it for the clearinghouse or put it on hold']
    ]);
  });

  it('shows who approved the claim and when', () => {
    show({
      status: 'approved',
      reviewed_by: 'Dana Biller',
      reviewed_at: '2026-10-02T15:04:00Z',
      review_note: null
    });
    const shown = details();
    assert.deepEqual(shown.slice(0, 3), [
      ['Status', 'Approved'],
      ['Revision', '1'],
      ['Approved By', 'Dana Biller']
    ]);
    assert.notEqual(shown[3]?.[1], '—');
    assert.deepEqual(shown[4], ['Note', '—']);
  });

  it('shows why a claim is on hold', () => {
    show({
      status: 'on_hold',
      reviewed_by: 'Dana Biller',
      reviewed_at: '2026-10-02T15:04:00Z',
      review_note: 'Need the PCS'
    });
    assert.deepEqual(details()[2], ['Held By', 'Dana Biller']);
    assert.deepEqual(details()[4], ['Note', 'Need the PCS']);
  });
});
