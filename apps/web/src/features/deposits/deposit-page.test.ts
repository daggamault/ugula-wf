import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { idleLive } from '../../shared/testing.ts';
import { render, screen } from '../../shared/testing-dom.ts';
import type { Deposit, DepositsClient } from './client.ts';
import { DepositPage } from './deposit-page.tsx';

const matched: Deposit = {
  id: 'd1',
  trace_number: '1234567890',
  amount_cents: 60_000,
  deposited_on: '2026-11-02',
  payer_name: 'Medicare',
  note: 'Batch 7',
  payer_file_id: 'f1',
  file_name: 'era.835',
  payment_cents: 60_000,
  paid_on: '2026-10-30',
  created_by: 'ann@example.com',
  created_at: '2026-11-02T15:00:00Z'
};

const unmatched: Deposit = {
  ...matched,
  payer_file_id: null,
  file_name: null,
  payment_cents: null,
  paid_on: null
};

const show = (found: () => Promise<Deposit>) => {
  const read: string[] = [];
  render(
    createElement(DepositPage, {
      client: {
        deposit: (id: string) => {
          read.push(id);
          return found();
        }
      } as DepositsClient,
      live: idleLive,
      depositId: 'd1',
      back: '/deposits?q=123'
    })
  );
  return read;
};

const detail = (label: string) => screen.getByText(label).nextElementSibling?.textContent;

describe('DepositPage', () => {
  it('shows the deposit and the remittance it matched', async () => {
    const read = show(async () => matched);
    assert.ok(await screen.findByRole('heading', { name: 'Deposit 1234567890', level: 1 }));
    assert.deepEqual(read, ['d1']);
    assert.equal(
      screen.getByRole('link', { name: 'Back to Deposits' }).getAttribute('href'),
      '/deposits?q=123'
    );
    assert.equal(detail('Amount'), '$600.00');
    assert.equal(detail('Deposited On'), 'Nov 2, 2026');
    assert.equal(detail('Payer'), 'Medicare');
    assert.equal(detail('Note'), 'Batch 7');
    assert.equal(
      screen.getByRole('link', { name: 'era.835' }).getAttribute('href'),
      '/payer-files/f1'
    );
    assert.equal(detail('Payment'), '$600.00');
    assert.equal(detail('Paid On'), 'Oct 30, 2026');
    assert.equal(screen.queryByText(/has not been matched/), null);
  });

  it('says how an unmatched deposit gets matched', async () => {
    show(async () => unmatched);
    const alert = await screen.findByText(/has not been matched to a remittance yet/);
    assert.match(alert.textContent ?? '', /Reconcile Deposit matches it/);
    assert.equal(screen.queryByRole('link', { name: 'era.835' }), null);
  });

  it('says why the deposit could not be opened', async () => {
    show(() => Promise.reject(new Error('Deposit not found')));
    assert.ok(await screen.findByText('Deposit not found'));
  });
});
