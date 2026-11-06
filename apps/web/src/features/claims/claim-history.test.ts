import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { amountOf, EventsTable, paymentDetailsOf, reasonsOf } from './claim-history.tsx';

describe('paymentDetailsOf', () => {
  it('lists the paid date, check number and payer claim number a payment came with', () => {
    assert.equal(
      paymentDetailsOf({
        paid_on: '2026-10-20',
        check_number: 'EFT-9',
        payer_claim_number: 'ICN1'
      }),
      'Paid Oct 20, 2026 · Check or EFT EFT-9 · Payer claim ICN1'
    );
    assert.equal(
      paymentDetailsOf({ paid_on: null, check_number: null, payer_claim_number: null }),
      ''
    );
  });
});

describe('amountOf', () => {
  it('describes paid and adjusted amounts together, and refunds as paid back', () => {
    assert.equal(
      amountOf({ kind: 'response', paid_cents: 40_000, adjusted_cents: 10_000 }),
      '$400.00 paid · $100.00 adjusted'
    );
    assert.equal(amountOf({ kind: 'response', paid_cents: 0, adjusted_cents: 0 }), '');
    assert.equal(
      amountOf({ kind: 'refunded', paid_cents: -2_500, adjusted_cents: 0 }),
      '$25.00 refunded'
    );
  });
});

describe('EventsTable', () => {
  it('links submissions to the 837P file they went out in', () => {
    const html = renderToStaticMarkup(
      createElement(EventsTable, {
        events: [
          {
            id: 'e1',
            kind: 'submitted',
            coverage_id: 'cov-m',
            payer: 'Medicare',
            paid_cents: 0,
            adjusted_cents: 0,
            paid_on: null,
            check_number: null,
            payer_claim_number: null,
            note: '837P batch #4',
            created_at: '2026-10-02T00:00:00Z',
            has_document: false,
            batch_id: 'b4',
            batch_number: 4
          }
        ],
        documentUrl: () => '',
        fileUrl: (id) => `/files/${id}`
      })
    );
    assert.ok(html.includes('href="/files/b4"') && /837P File #(<!-- -->)?4/.test(html));
  });
});

describe('reasonsOf', () => {
  it('describes each adjustment with its group and amount, then each remark', () => {
    assert.deepEqual(
      reasonsOf({
        adjustments: [
          { group: 'CO', reason: '45', cents: 15_995, description: 'Charge exceeds fee schedule.' },
          { group: 'PR', reason: '999', cents: 100, description: null }
        ],
        remarks: [
          { code: 'N130', description: 'Consult plan benefit documents.' },
          { code: 'MA01', description: null }
        ]
      }),
      [
        'Contractual obligation: Charge exceeds fee schedule. (CO-45) · $159.95',
        'Patient responsibility: PR-999 · $1.00',
        'Consult plan benefit documents. (N130)',
        'MA01'
      ]
    );
    assert.deepEqual(reasonsOf({}), []);
  });
});
