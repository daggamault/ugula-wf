import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PayerFileItems } from './payer-file-page.tsx';

describe('payer file page', () => {
  it('shows each line with its claim, outcome, amounts and why', () => {
    const html = renderToStaticMarkup(
      createElement(PayerFileItems, {
        items: [
          {
            position: 1,
            reference: '1001',
            claim_id: 'c1',
            claim_number: 1001,
            outcome: 'posted',
            message: '',
            paid_cents: 60_000,
            adjusted_cents: 25_000
          },
          {
            position: 2,
            reference: '9999',
            claim_id: null,
            claim_number: null,
            outcome: 'unmatched',
            message: 'No claim has number 9999',
            paid_cents: null,
            adjusted_cents: null
          }
        ]
      })
    );
    assert.ok(html.includes('#1001') && html.includes('Posted') && html.includes('$600.00'));
    assert.ok(html.includes('No Match') && html.includes('No claim has number 9999'));
    assert.ok(html.includes('href="/claims/c1"'));
  });
});
