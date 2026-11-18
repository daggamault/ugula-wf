import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { render, screen, within } from '../testing-dom.ts';
import { type ClaimPayment, PaymentsPanel, reasonCodes } from './claim-payments.tsx';

const payment: ClaimPayment = {
  id: 'p1',
  remittance_id: 'r1',
  coverage_position: 1,
  outcome: 'paid',
  paid_cents: 61_200,
  patient_cents: 15_300,
  adjustments: [
    { group: 'CO', reason: '45', cents: 8_500 },
    { group: 'PR', reason: '2', cents: 15_300 }
  ],
  remarks: ['N130'],
  payer_name: 'Medicare',
  paid_on: '2026-11-03',
  trace_number: 'EFT1'
};

describe('reasonCodes', () => {
  it('writes each adjustment with its amount, then the remarks', () => {
    assert.equal(reasonCodes(payment), 'CO-45 $85.00 · PR-2 $153.00 · N130');
    assert.equal(reasonCodes({ adjustments: [], remarks: [] }), '');
  });
});

describe('PaymentsPanel', () => {
  it('lists what each payer paid and left, linked to its remittance', () => {
    render(
      createElement(PaymentsPanel, {
        payments: [payment, { ...payment, id: 'p2', outcome: 'denied', paid_cents: 0 }]
      })
    );
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    assert.equal(items.length, 2);
    assert.ok(within(items[0] as HTMLElement).getByText('Paid $612.00 · patient owes $153.00'));
    assert.ok(within(items[1] as HTMLElement).getByText('Denied'));
    assert.equal(
      within(items[0] as HTMLElement)
        .getByRole('link', { name: 'Medicare' })
        .getAttribute('href'),
      '/remittances/r1'
    );
  });

  it('says when no payer has decided the claim', () => {
    render(createElement(PaymentsPanel, { payments: [] }));
    assert.ok(screen.getByText('No payer has paid or denied this claim yet.'));
  });
});
