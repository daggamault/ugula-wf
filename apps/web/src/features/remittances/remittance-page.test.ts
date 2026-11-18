import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { idleLive } from '../../shared/testing.ts';
import { render, screen } from '../../shared/testing-dom.ts';
import type { Remittance, RemittancePayment, RemittancesClient } from './client.ts';
import {
  adjustmentText,
  PaymentsTable,
  RemittancePage,
  RemittanceSummaryPanel
} from './remittance-page.tsx';
import { RemittanceState, remittanceName } from './remittances-page.tsx';

const remittance: Remittance = {
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
  unmatched_count: 0,
  is_balanced: true,
  reconciled_at: null,
  file_name: 'DEVEMS01_835_1.835',
  payment_count: 2,
  reconcile_note: null,
  reconciled_by: null
};

const payment: RemittancePayment = {
  id: 'p1',
  claim_id: 'c1',
  claim_number: '20261103-0001',
  coverage_position: 1,
  outcome: 'paid',
  status_code: '1',
  charge_cents: 85_000,
  paid_cents: 61_200,
  patient_cents: 15_300,
  payer_claim_number: 'MOCK-1',
  adjustments: [{ group: 'PR', reason: '2', cents: 15_300 }],
  remarks: [],
  first_name: 'Ada',
  last_name: 'Lovelace'
};

describe('remittance names and states', () => {
  it('names a remittance by payer and trace number', () => {
    assert.equal(remittanceName(remittance), 'MEDICARE EFT-42');
    assert.equal(remittanceName({ payer_name: null, trace_number: null }), 'Unknown payer');
  });

  it('says whether it is reconciled, needs reconciling or is open', () => {
    const state = (r: Partial<Remittance>) =>
      renderToStaticMarkup(createElement(RemittanceState, { remittance: { ...remittance, ...r } }));
    assert.match(state({ reconciled_at: '2026-11-03T13:00:00Z' }), /Reconciled/);
    assert.match(state({ unmatched_count: 1 }), /Needs Reconciling/);
    assert.match(state({ is_balanced: false }), /Needs Reconciling/);
    assert.match(state({}), /Open/);
  });
});

describe('RemittanceSummaryPanel', () => {
  it('shows the payment, whether it balances, and who reconciled it', () => {
    const html = renderToStaticMarkup(
      createElement(RemittanceSummaryPanel, {
        remittance: { ...remittance, reconciled_at: '2026-11-03T13:00:00Z' }
      })
    );
    assert.ok(html.includes('$612.00') && html.includes('EFT-42'));
    assert.ok(html.includes('Automatically'));
  });
});

describe('PaymentsTable', () => {
  it('lists each claim payment, and marks one that matched no claim', () => {
    const html = renderToStaticMarkup(
      createElement(PaymentsTable, {
        payments: [payment, { ...payment, id: 'p2', claim_id: null, claim_number: 'X-9' }],
        back: '/remittances/r1'
      })
    );
    assert.ok(html.includes('Lovelace, Ada') && html.includes('Matched no claim'));
    assert.ok(html.includes('Unmatched') && html.includes('PR-2 $153.00'));
    assert.equal(html.match(/href="\/claims\/c1/g)?.length, 1);
    assert.equal(adjustmentText({ adjustments: [], remarks: ['N130'] }), 'N130');
  });
});

describe('RemittancePage', () => {
  it('loads the remittance with its payments', async () => {
    const client: RemittancesClient = {
      search: () => new Promise(() => undefined),
      find: async () => ({ remittance, payments: [payment] })
    };
    render(createElement(RemittancePage, { client, live: idleLive, remittanceId: 'r1' }));
    assert.ok(await screen.findByRole('heading', { name: 'MEDICARE EFT-42' }));
    assert.ok(screen.getByText('20261103-0001'));
  });
});
