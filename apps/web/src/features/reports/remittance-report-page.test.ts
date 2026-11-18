import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { RemittanceReport } from './client.ts';
import { RemittanceReportView, remittancesCsv, stateOf } from './remittance-report-page.tsx';

const report: RemittanceReport = {
  period: { from: '2026-11-01', to: '2026-11-30' },
  totals: {
    remittances: 2,
    totalCents: 80_000,
    claimPaidCents: 80_800,
    providerAdjustmentCents: 800,
    unbalanced: 0,
    unmatched: 1,
    open: 1
  },
  remittances: [
    {
      id: 'r1',
      paid_on: '2026-11-03',
      payer_name: 'MEDICARE',
      trace_number: 'EFT-1',
      payment_method: 'ACH',
      total_cents: 61_200,
      claim_paid_cents: 61_200,
      provider_adjustment_cents: 0,
      unmatched_count: 0,
      is_balanced: true,
      reconciled_at: '2026-11-03T13:00:00Z',
      payment_count: 1
    },
    {
      id: 'r2',
      paid_on: '2026-11-04',
      payer_name: 'BLUE, PLAN',
      trace_number: null,
      payment_method: null,
      total_cents: 18_800,
      claim_paid_cents: 19_600,
      provider_adjustment_cents: 800,
      unmatched_count: 1,
      is_balanced: true,
      reconciled_at: null,
      payment_count: 2
    }
  ],
  unmatched: [
    {
      id: 'p9',
      paid_on: '2026-11-04',
      payer_name: 'BLUE, PLAN',
      trace_number: null,
      claim_number: 'NOT-OURS-1',
      charge_cents: 1_000,
      paid_cents: 800,
      patient_cents: 200,
      payer_claim_number: 'P-9'
    }
  ],
  truncated: false
};

describe('stateOf', () => {
  it('says whether a remittance is reconciled, needs reconciling or is open', () => {
    const [done, open] = report.remittances;
    assert.ok(done && open);
    assert.equal(stateOf(done), 'Reconciled');
    assert.equal(stateOf(open), 'Needs Reconciling');
    assert.equal(stateOf({ ...open, unmatched_count: 0 }), 'Open');
  });
});

describe('remittancesCsv', () => {
  it('writes one row per remittance in dollars, quoting what needs it', () => {
    const lines = remittancesCsv(report).split('\r\n');
    assert.equal(
      lines[0],
      'Paid,Payer,Trace Number,Method,Amount,Claim Payments,Provider Adjustments,Claims,Unmatched,Balances,State'
    );
    assert.equal(lines[1], '2026-11-03,MEDICARE,EFT-1,ACH,612.00,612.00,0.00,1,0,Yes,Reconciled');
    assert.equal(
      lines[2],
      '2026-11-04,"BLUE, PLAN",,,188.00,196.00,8.00,2,1,Yes,Needs Reconciling'
    );
  });
});

describe('RemittanceReportView', () => {
  it('shows the totals, each remittance and the payments that matched no claim', () => {
    const html = renderToStaticMarkup(createElement(RemittanceReportView, { report }));
    assert.ok(html.includes('$800.00') && html.includes('$612.00'));
    assert.ok(html.includes('(1 unmatched)') && html.includes('NOT-OURS-1'));
    assert.ok(html.includes('Payer claim P-9'));
    assert.ok(!html.includes('more remittances than the report shows'));
  });

  it('says when the period holds more than it shows, and when there is nothing', () => {
    const html = renderToStaticMarkup(
      createElement(RemittanceReportView, {
        report: { ...report, remittances: [], unmatched: [], truncated: true }
      })
    );
    assert.ok(html.includes('more remittances than the report shows'));
    assert.ok(html.includes('No remittances were paid in this period.'));
    assert.ok(html.includes('Every payment in this period matched a claim.'));
  });
});
