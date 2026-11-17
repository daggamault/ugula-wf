import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { invokeNode } from '@ugula/graph/testing';
import { billingStores } from '../testing.ts';
import { accountingNodes } from './accounting.ts';
import type { AccountingStore, DepositPair } from './stores.ts';

const pair: DepositPair = {
  depositId: 'd1',
  payerFileId: 'f1',
  depositTrace: 'EFT1',
  depositCents: 1000,
  remittanceTrace: 'EFT1',
  remittanceCents: 1000,
  payerName: 'MEDICARE',
  fileName: 'era.835'
};

const totals = {
  chargesCents: 100,
  paymentsCents: 80,
  refundsCents: 0,
  adjustmentsCents: 10,
  writeOffsCents: 5
};

const recording = () => {
  const calls: unknown[][] = [];
  const store: AccountingStore = {
    depositPairs: async (...args) => {
      calls.push(['depositPairs', ...args]);
      return [pair];
    },
    matchDeposit: async (...args) => {
      calls.push(['matchDeposit', ...args]);
    },
    unmatchedPayments: async (...args) => {
      calls.push(['unmatchedPayments', ...args]);
      return { deposits: [], remittances: [] };
    },
    periodTotals: async (...args) => {
      calls.push(['periodTotals', ...args]);
      return totals;
    },
    closePeriod: async (...args) => {
      calls.push(['closePeriod', ...args]);
    }
  };
  const nodes = accountingNodes(() => billingStores({ accounting: store }));
  const node = (type: string) => {
    const n = nodes.find((x) => x.type === type);
    if (!n) throw new Error(`No ${type}`);
    return n;
  };
  return { calls, node };
};

describe('accountingNodes', () => {
  it('reads the deposit pairs of a deposit or a remittance file, and needs one', async () => {
    const { calls, node } = recording();
    const { outputs } = await invokeNode(node('billing.read-deposit-pairs'), {
      inputs: { depositId: 'd1' }
    });
    assert.deepEqual(outputs, { pairs: [pair] });
    assert.deepEqual(calls, [['depositPairs', 'run', { depositId: 'd1', payerFileId: null }]]);
    await assert.rejects(() => invokeNode(node('billing.read-deposit-pairs'), { inputs: {} }), {
      message: 'No deposit or remittance file to match'
    });
  });

  it('saves a match', async () => {
    const { calls, node } = recording();
    await invokeNode(node('billing.save-deposit-match'), {
      inputs: { depositId: 'd1', payerFileId: 'f1' }
    });
    assert.deepEqual(calls, [['matchDeposit', 'run', 'd1', 'f1']]);
  });

  it('reads unmatched payments up to a day', async () => {
    const { calls, node } = recording();
    const { outputs } = await invokeNode(node('billing.read-unmatched-payments'), {
      inputs: { before: '2026-11-14' }
    });
    assert.deepEqual(outputs, { deposits: [], remittances: [] });
    assert.deepEqual(calls, [['unmatchedPayments', 'run', '2026-11-14']]);
    await assert.rejects(
      () => invokeNode(node('billing.read-unmatched-payments'), { inputs: { before: 'soon' } }),
      { message: 'soon is not a date' }
    );
  });

  it('totals and closes a month given as its first day', async () => {
    const { calls, node } = recording();
    const { outputs } = await invokeNode(node('billing.read-period-totals'), {
      inputs: { period: '2026-10-01' }
    });
    assert.deepEqual(outputs, totals);
    await invokeNode(node('billing.record-period-close'), {
      inputs: { period: '2026-10-01', closedBy: 'u1' }
    });
    assert.deepEqual(calls, [
      ['periodTotals', 'run', '2026-10-01'],
      ['closePeriod', 'run', '2026-10-01', 'u1']
    ]);
    await assert.rejects(
      () => invokeNode(node('billing.record-period-close'), { inputs: { period: '2026-10-02' } }),
      { message: '2026-10-02 is not the first day of a month' }
    );
  });
});
