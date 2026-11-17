import { f, model } from './model-kit.ts';

export const DEPOSIT_PAIR = model(
  'billing.deposit-pair',
  'pair',
  'Deposit and Remittance',
  'an unmatched bank deposit and an unmatched 835 remittance file that share its trace number',
  [
    f('depositId', { id: 'deposit' }, 'Deposit'),
    f('payerFileId', { id: 'payerFile' }, 'Remittance file'),
    f('depositTrace', 'string', 'Trace number of the deposit'),
    f('depositCents', 'integer', 'Amount deposited (cents)'),
    f('remittanceTrace', 'string', 'Trace number of the 835 (TRN02)'),
    f('remittanceCents', 'integer', 'Payment amount of the 835 (BPR02, cents)'),
    f('payerName', 'string', 'Payer that sent the 835'),
    f('fileName', 'string', 'Name of the 835 file')
  ]
);

export const UNMATCHED_PAYMENT = model(
  'billing.unmatched-payment',
  'payment',
  'Unmatched Payment',
  'a bank deposit with no 835 remittance matched to it, or an 835 remittance with no deposit',
  [
    f('kind', 'string', 'What is unmatched: deposit or remittance'),
    f('depositId', { id: 'deposit' }, 'Deposit, for a deposit'),
    f('payerFileId', { id: 'payerFile' }, 'Remittance file, for a remittance'),
    f('traceNumber', 'string', 'Trace number'),
    f('amountCents', 'integer', 'Amount (cents)'),
    f('receivedOn', 'string', 'Day it was deposited or the 835 arrived (YYYY-MM-DD)'),
    f('payerName', 'string', 'Payer')
  ]
);
