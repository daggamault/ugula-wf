import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { RemittanceSummary } from './client.ts';
import { RemittancesTable } from './remittances-page.tsx';

const row: RemittanceSummary = {
  id: 'r1',
  created_at: '2026-11-03T12:00:00Z',
  paid_on: '2026-11-03',
  payer_name: 'MEDICARE',
  payer_code: 'DEMOMCR',
  trace_number: 'EFT-42',
  payment_method: 'ACH',
  total_cents: 61_200,
  claim_paid_cents: 61_200,
  provider_adjustment_cents: 0,
  unmatched_count: 1,
  is_balanced: true,
  reconciled_at: null,
  file_name: 'A.835',
  payment_count: 3
};

describe('RemittancesTable', () => {
  it('lists each remittance with its amount, claims and state, opening it', () => {
    const html = renderToStaticMarkup(
      createElement(RemittancesTable, {
        remittances: [row],
        search: {
          q: '',
          href: '/remittances',
          sort: 'received',
          dir: 'desc',
          sortHref: () => '/remittances'
        } as never
      })
    );
    assert.ok(html.includes('MEDICARE') && html.includes('EFT-42') && html.includes('$612.00'));
    assert.ok(html.includes('(1 unmatched)') && html.includes('Needs Reconciling'));
    assert.match(html, /href="\/remittances\/r1[^"]*"/);
  });
});
