import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CLAIM_STATUSES, type ClaimStatus } from '@ugula/billing';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { titleCaseLabel } from '../../shared/format.ts';
import { ClaimStatusBadge } from './claim-status-badge.tsx';

const html = (status: ClaimStatus) =>
  renderToStaticMarkup(createElement(ClaimStatusBadge, { status }));

const labelOf = (status: ClaimStatus) => /<span[^>]*>([^<]+)<\/span>/.exec(html(status))?.[1] ?? '';

describe('ClaimStatusBadge', () => {
  it('labels each claim status in the words a biller uses', () => {
    assert.equal(labelOf('needs_review'), 'Needs Review');
    assert.equal(labelOf('collections'), 'Sent to Collections');
    assert.equal(labelOf('paid'), 'Paid');
  });

  it('gives every status a Title Case label and tints work states by intent', () => {
    for (const s of CLAIM_STATUSES) assert.equal(titleCaseLabel(labelOf(s)), labelOf(s));
    assert.ok(html('needs_review').includes('text-warning'));
    assert.ok(html('collections').includes('text-danger'));
    assert.ok(html('void').includes('text-surface-fg-muted'));
  });
});
