import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CLAIM_STATUSES } from '@ugula/billing';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { titleCaseLabel } from '../../shared/format.ts';
import { CLAIM_FILTERS, ClaimStatusBadge } from './claim-status-badge.tsx';

describe('ClaimStatusBadge', () => {
  it('labels each claim status in the words a biller uses', () => {
    const label = (value: string) => CLAIM_FILTERS.find((f) => f.value === value)?.label;
    assert.equal(label('needs_review'), 'Needs Review');
    assert.equal(label('collections'), 'Sent to Collections');
    const html = renderToStaticMarkup(createElement(ClaimStatusBadge, { status: 'paid' }));
    assert.ok(html.includes('>Paid<'));
  });

  it('offers open claims first, then every status in workflow order, then all', () => {
    assert.deepEqual(
      CLAIM_FILTERS.map((f) => f.value),
      ['open', ...CLAIM_STATUSES, 'all']
    );
  });

  it('gives every status a Title Case label and tints work states by intent', () => {
    for (const { label } of CLAIM_FILTERS) assert.equal(titleCaseLabel(label), label);
    const html = (status: (typeof CLAIM_STATUSES)[number]) =>
      renderToStaticMarkup(createElement(ClaimStatusBadge, { status }));
    assert.ok(html('needs_review').includes('text-warning'));
    assert.ok(html('collections').includes('text-danger'));
    assert.ok(html('void').includes('text-surface-fg-muted'));
  });
});
