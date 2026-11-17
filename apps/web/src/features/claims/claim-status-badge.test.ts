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
      needs_review: 'Needs Review'
    });
  });

  it('gives every status a Title Case label', () => {
    for (const s of CLAIM_STATUSES) assert.equal(titleCaseLabel(badge(s).label), badge(s).label);
  });

  it('tints statuses by the attention they need', () => {
    assert.deepEqual(Object.fromEntries(CLAIM_STATUSES.map((s) => [s, tintOf(s)])), {
      needs_review: 'text-warning-text'
    });
  });
});
