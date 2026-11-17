import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CLAIM_STATUSES, type ClaimStatus } from '@ugula/billing';
import { createElement } from 'react';
import { titleCaseLabel } from '../../shared/format.ts';
import { render } from '../../shared/testing-dom.ts';
import { ClaimStatusBadge } from './claim-status-badge.tsx';

const badge = (status: ClaimStatus) => {
  const { container, unmount } = render(createElement(ClaimStatusBadge, { status }));
  const span = container.firstElementChild as HTMLElement;
  const shown = { label: span.textContent ?? '', className: span.className };
  unmount();
  return shown;
};

const tintOf = (status: ClaimStatus) =>
  ['text-primary', 'text-success', 'text-info', 'text-warning-text', 'text-danger'].find((c) =>
    badge(status).className.split(' ').includes(c)
  ) ?? 'muted';

describe('ClaimStatusBadge', () => {
  it('labels each claim status in the words a biller uses', () => {
    assert.deepEqual(Object.fromEntries(CLAIM_STATUSES.map((s) => [s, badge(s).label])), {
      draft: 'Draft',
      needs_review: 'Needs Review',
      ready: 'Ready to Submit',
      submitted: 'Submitted',
      follow_up: 'Needs Follow-Up',
      reconcile: 'Reconcile Payment',
      denied: 'Denied',
      facility_billing: 'Billed to Facility',
      patient_balance: 'Patient Balance',
      balance_review: 'Balance Review',
      paid: 'Paid',
      written_off: 'Written Off',
      collections: 'Sent to Collections',
      void: 'Void'
    });
  });

  it('gives every status a Title Case label', () => {
    for (const s of CLAIM_STATUSES) assert.equal(titleCaseLabel(badge(s).label), badge(s).label);
  });

  it('tints statuses by the attention they need', () => {
    assert.deepEqual(Object.fromEntries(CLAIM_STATUSES.map((s) => [s, tintOf(s)])), {
      draft: 'muted',
      needs_review: 'text-warning-text',
      ready: 'text-primary',
      submitted: 'text-info',
      follow_up: 'text-warning-text',
      reconcile: 'text-warning-text',
      denied: 'text-danger',
      facility_billing: 'text-info',
      patient_balance: 'text-info',
      balance_review: 'text-warning-text',
      paid: 'text-success',
      written_off: 'muted',
      collections: 'text-danger',
      void: 'muted'
    });
    assert.ok(badge('void').className.split(' ').includes('text-surface-fg-muted'));
  });
});
