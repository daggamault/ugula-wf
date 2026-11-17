import { actionNode, isIsoDate, pin } from '@ugula/graph';
import { DEPOSIT_PAIR, UNMATCHED_PAYMENT } from '../accounting-models.ts';
import { requiredText } from '../values.ts';
import type { NodesOf } from './stores.ts';

const CATEGORY = 'Billing';

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])-01$/;

const PERIOD_PIN = pin('period', 'string', {
  label: 'First Day of the Month',
  description: 'The accounting month, as its first day (YYYY-MM-01).'
});

const periodOf = (period: string | null | undefined) => {
  const p = requiredText(period, 'No month given');
  if (!PERIOD.test(p)) throw new Error(`${p} is not the first day of a month`);
  return p;
};

const CENTS = (name: string, label: string, description: string) =>
  pin(name, 'integer', { label, description });

export const accountingNodes: NodesOf = (stores) => {
  const accounting = () => stores().accounting;
  return [
    actionNode({
      type: 'billing.read-deposit-pairs',
      title: 'Read Deposit Pairs',
      category: CATEGORY,
      description:
        'Reads each unmatched bank deposit and unmatched 835 remittance file that share a trace number, for one deposit or one file. Decides nothing; Deposit Match does.',
      level: 'basic',
      keywords: ['deposit', 'EFT', 'trace number', 'reassociation', 'reconcile'],
      inputs: [
        pin(
          'depositId',
          { id: 'deposit' },
          {
            label: 'Deposit',
            description: 'The deposit to find its 835 for.',
            optional: true
          }
        ),
        pin(
          'payerFileId',
          { id: 'payerFile' },
          {
            label: 'Remittance File',
            description: 'The 835 to find its deposit for.',
            optional: true
          }
        )
      ],
      outputs: [
        pin(
          'pairs',
          { list: DEPOSIT_PAIR.type },
          {
            label: 'Deposit Pairs',
            description: 'Each unmatched deposit and 835 with the same trace number.'
          }
        )
      ],
      compute: async ({ depositId, payerFileId }, _, ctx) => {
        if (!depositId && !payerFileId) throw new Error('No deposit or remittance file to match');
        return {
          pairs: await accounting().depositPairs(ctx.runId, {
            depositId: depositId ?? null,
            payerFileId: payerFileId ?? null
          })
        };
      }
    }),
    actionNode({
      type: 'billing.save-deposit-match',
      title: 'Save Deposit Match',
      category: CATEGORY,
      description:
        'Matches a bank deposit to its 835 remittance file; a deposit or file already matched to another is left alone.',
      level: 'basic',
      keywords: ['deposit', 'EFT', 'reassociation', 'reconcile'],
      effect: true,
      inputs: [
        pin('depositId', { id: 'deposit' }, { label: 'Deposit', description: 'The deposit.' }),
        pin(
          'payerFileId',
          { id: 'payerFile' },
          {
            label: 'Remittance File',
            description: 'The 835 that paid it.'
          }
        )
      ],
      outputs: [],
      compute: async (inputs, _, ctx) => {
        await accounting().matchDeposit(
          ctx.runId,
          requiredText(inputs.depositId, 'No deposit to match'),
          requiredText(inputs.payerFileId, 'No remittance file to match')
        );
        return {};
      }
    }),
    actionNode({
      type: 'billing.read-unmatched-payments',
      title: 'Read Unmatched Payments',
      category: CATEGORY,
      description:
        'Reads the bank deposits with no 835 matched, and the 835 remittance files with a trace number and no deposit, that came in on or before a day and were not reported yet. Decides nothing.',
      level: 'basic',
      keywords: ['deposit', 'EFT', 'remittance', 'reconcile'],
      inputs: [
        pin('before', 'string', {
          label: 'On or Before',
          description: 'The last day a payment counted came in (YYYY-MM-DD).'
        })
      ],
      outputs: [
        pin(
          'deposits',
          { list: UNMATCHED_PAYMENT.type },
          { description: 'Deposits without a remittance.' }
        ),
        pin(
          'remittances',
          { list: UNMATCHED_PAYMENT.type },
          { description: 'Remittances without a deposit.' }
        )
      ],
      compute: async ({ before }, _, ctx) => {
        if (!isIsoDate(before)) throw new Error(`${before} is not a date`);
        return accounting().unmatchedPayments(ctx.runId, before);
      }
    }),
    actionNode({
      type: 'billing.read-period-totals',
      title: 'Read Period Totals',
      category: CATEGORY,
      description:
        'Adds up the postings of an accounting month by their posting date: charges billed (first submissions), payments, refunds, adjustments and write-offs. Decides nothing.',
      level: 'basic',
      keywords: ['month end', 'period close', 'totals'],
      inputs: [PERIOD_PIN],
      outputs: [
        CENTS('chargesCents', 'Charges (Cents)', 'Charges of the claims first billed.'),
        CENTS('paymentsCents', 'Payments (Cents)', 'Payer and patient payments.'),
        CENTS('refundsCents', 'Refunds (Cents)', 'Refunds paid back.'),
        CENTS('adjustmentsCents', 'Adjustments (Cents)', 'Adjustments off balances.'),
        CENTS(
          'writeOffsCents',
          'Write-Offs (Cents)',
          'Balances written off or sent to collections.'
        )
      ],
      compute: async (inputs, _, ctx) =>
        accounting().periodTotals(ctx.runId, periodOf(inputs.period))
    }),
    actionNode({
      type: 'billing.close-period',
      title: 'Close Period',
      category: CATEGORY,
      description:
        'Closes an accounting month and emits Period Closed: postings dated in it from now on are posted to the next open month. A month already closed stays as it was.',
      level: 'basic',
      keywords: ['month end', 'period close', 'lock'],
      effect: true,
      inputs: [
        PERIOD_PIN,
        pin('closedBy', 'string', {
          label: 'Closed By',
          description: 'The user who approved closing it.',
          optional: true
        })
      ],
      outputs: [],
      compute: async (inputs, _, ctx) => {
        await accounting().closePeriod(ctx.runId, periodOf(inputs.period), inputs.closedBy ?? null);
        return {};
      }
    })
  ];
};
