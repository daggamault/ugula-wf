import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { render, screen, userEvent, waitFor } from '../../shared/testing-dom.ts';
import { type ToastInput, ToastProvider } from '../../shared/ui/toast.tsx';
import type { DepositInput, DepositsClient } from './client.ts';
import { RecordDepositPage, toDepositInput } from './record-deposit-page.tsx';

const show = (record: DepositsClient['record']) => {
  window.history.replaceState(null, '', '/deposits/new');
  const toasts: ToastInput[] = [];
  render(
    createElement(
      ToastProvider,
      { onNotify: (t) => toasts.push(t) },
      createElement(RecordDepositPage, {
        client: { record } as DepositsClient,
        back: '/deposits?q=555'
      })
    )
  );
  return toasts;
};

const fill = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(screen.getByRole('textbox', { name: 'Trace Number' }), ' 1234567890 ');
  await user.type(screen.getByRole('spinbutton', { name: 'Amount (USD)' }), '600.5');
  await user.type(screen.getByLabelText(/Deposited On/), '2026-11-02');
  await user.type(screen.getByRole('textbox', { name: 'Payer' }), 'Medicare');
};

const submit = () => screen.getByRole('button', { name: 'Record Deposit' });

describe('RecordDepositPage', () => {
  it('records the deposit in cents and opens it', async () => {
    const recorded: DepositInput[] = [];
    const toasts = show(async (input) => {
      recorded.push(input);
      return { id: 'd9' };
    });
    assert.equal(
      screen.getByRole('link', { name: 'Back to Deposits' }).getAttribute('href'),
      '/deposits?q=555'
    );
    const user = userEvent.setup();
    await fill(user);
    await user.click(submit());
    await waitFor(() => assert.deepEqual(toasts, [{ title: 'Deposit 1234567890 recorded' }]));
    assert.deepEqual(recorded, [
      {
        traceNumber: '1234567890',
        amountCents: 60_050,
        depositedOn: '2026-11-02',
        payerName: 'Medicare',
        note: null
      }
    ]);
    assert.equal(window.location.pathname, '/deposits/d9');
  });

  it('says why a deposit could not be recorded and stays on the form', async () => {
    const toasts = show(async () => {
      throw new Error('Trace number 1234567890 is already recorded');
    });
    const user = userEvent.setup();
    await fill(user);
    await user.click(submit());
    assert.equal(
      (await screen.findByRole('alert')).textContent,
      'Trace number 1234567890 is already recorded'
    );
    assert.deepEqual(toasts, []);
    assert.equal(window.location.pathname, '/deposits/new');
    assert.equal(submit().hasAttribute('disabled'), false);
  });
});

describe('toDepositInput', () => {
  const draft = {
    traceNumber: '123',
    amount: '10',
    depositedOn: '2026-11-02',
    payerName: ' ',
    note: ' Late '
  };

  it('trims the text and leaves blank optional fields empty', () => {
    assert.deepEqual(toDepositInput(draft), {
      traceNumber: '123',
      amountCents: 1_000,
      depositedOn: '2026-11-02',
      payerName: null,
      note: 'Late'
    });
  });

  it('asks for a trace number, a positive amount and a day', () => {
    assert.equal(toDepositInput({ ...draft, traceNumber: ' ' }), 'Enter the trace number.');
    assert.equal(toDepositInput({ ...draft, amount: '0' }), 'Enter an amount greater than zero.');
    assert.equal(toDepositInput({ ...draft, amount: 'x' }), 'Enter an amount greater than zero.');
    assert.equal(toDepositInput({ ...draft, depositedOn: '' }), 'Enter the day it was deposited.');
  });
});
