import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ClaimStatusBadge, claimStatusLabel } from './claim-status-badge.tsx';

describe('ClaimStatusBadge', () => {
  it('labels each claim status with an intent', () => {
    assert.equal(claimStatusLabel('written_off'), 'Written off');
    const html = renderToStaticMarkup(createElement(ClaimStatusBadge, { status: 'paid' }));
    assert.ok(html.includes('>Paid<'));
  });
});
