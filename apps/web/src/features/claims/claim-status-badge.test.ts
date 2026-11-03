import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CLAIM_STATUSES } from '@ugula/billing';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
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
});
