import { actionNode, pin, pureNode } from '@ugula/graph';
import { renderAppealPacket } from '../documents.ts';
import { DENIAL_FACTS, PATIENT_BALANCE_FACTS, REFUND_FACTS, X837_CLAIM } from '../models.ts';
import {
  appealOutcomeOf,
  denialFactsOf,
  patientBalanceFactsOf,
  refundFactsOf
} from '../recovery.ts';
import { isCents, recordOf, requiredText, textOrNull } from '../values.ts';
import { claimIdOf, claimIdPin } from './claims.ts';
import type { NodesOf } from './stores.ts';

const CATEGORY = 'Billing';

const coverageIdPin = pin('coverageId', 'string');

const coverageIdOf = (x: unknown) => requiredText(x, 'No payer to work on');

const centsOf = (x: unknown, what: string) => {
  if (!isCents(x)) throw new Error(`${what} must be a whole number of cents`);
  return x;
};

export const recoveryNodes: NodesOf = (stores) => {
  const claims = () => stores().claims;
  const recovery = () => stores().recovery;
  const ledgerOf = async (runId: string, claimId: string) => {
    const ledger = await claims().ledger(runId, claimId);
    if (!ledger) throw new Error(`Claim ${claimId} does not exist`);
    return ledger;
  };
  return [
    actionNode({
      type: 'billing.read-denial',
      title: 'Read Denial',
      category: CATEGORY,
      description:
        "Reads the denial a payer sent on a claim (Denial Facts): how Remittance Routing routed it, its reason codes, the remittance date, the appeals already sent and the payer's correction and appeal settings. Decides nothing.",
      inputs: [claimIdPin, coverageIdPin],
      outputs: [pin('denial', DENIAL_FACTS.type)],
      compute: async (inputs, _, ctx) => ({
        denial: denialFactsOf(
          await ledgerOf(ctx.runId, claimIdOf(inputs.claimId)),
          coverageIdOf(inputs.coverageId)
        )
      })
    }),
    actionNode({
      type: 'billing.read-appeal',
      title: 'Read Appeal Outcome',
      category: CATEGORY,
      description:
        'Reads whether the payer answered the last appeal on a claim with a new remittance, what it paid and whether it denied again, with how many claim signals the history reflects. Decides nothing; Appeal Decision does.',
      inputs: [claimIdPin, coverageIdPin],
      outputs: [
        pin('decided', 'boolean'),
        pin('paidCents', 'integer'),
        pin('deniedAgain', 'boolean'),
        pin('balanceCents', 'integer'),
        pin('signalsSeen', 'integer')
      ],
      compute: async (inputs, _, ctx) => {
        const ledger = await ledgerOf(ctx.runId, claimIdOf(inputs.claimId));
        return {
          ...appealOutcomeOf(ledger, coverageIdOf(inputs.coverageId)),
          signalsSeen: ledger.signalsSeen
        };
      }
    }),
    actionNode({
      type: 'billing.read-refund',
      title: 'Read Credit Balance',
      category: CATEGORY,
      description:
        'Reads how much more has been paid on a claim than it charges, who paid last and when the credit balance appeared (Refund Facts). Decides nothing; Refund Due does.',
      inputs: [claimIdPin],
      outputs: [pin('refund', REFUND_FACTS.type)],
      compute: async (inputs, _, ctx) => ({
        refund: refundFactsOf(await ledgerOf(ctx.runId, claimIdOf(inputs.claimId)))
      })
    }),
    actionNode({
      type: 'billing.read-patient-balance',
      title: 'Read Patient Balance',
      category: CATEGORY,
      description:
        "Reads what is left for the patient (Patient Balance Facts): the balance, the cost share the last payer stated, the pickup state, the date of service and the last payer's plan type. Decides nothing; Patient Responsibility does.",
      inputs: [claimIdPin],
      outputs: [pin('patientBalance', PATIENT_BALANCE_FACTS.type)],
      compute: async (inputs, _, ctx) => ({
        patientBalance: patientBalanceFactsOf(await ledgerOf(ctx.runId, claimIdOf(inputs.claimId)))
      })
    }),
    actionNode({
      type: 'billing.record-refund',
      title: 'Record Refund',
      category: CATEGORY,
      description:
        'Records a refund on the claim ledger, paid back to a payer on the claim or to the patient when no payer is given, once per run step. Refunds more than was paid fault the step.',
      effect: true,
      inputs: [
        claimIdPin,
        pin('coverageId', 'string', { optional: true }),
        pin('amountCents', 'integer'),
        pin('note', 'string', { optional: true })
      ],
      outputs: [],
      compute: async (inputs, _, ctx) => {
        await recovery().recordRefund(ctx.runId, claimIdOf(inputs.claimId), ctx.key, {
          coverageId: textOrNull(inputs.coverageId),
          cents: centsOf(inputs.amountCents, 'The refund'),
          note: textOrNull(inputs.note) ?? 'Refund of a credit balance'
        });
        return {};
      }
    }),
    actionNode({
      type: 'billing.protect-balance',
      title: 'Protect Patient Balance',
      category: CATEGORY,
      description:
        "Takes what state balance-billing law keeps off the patient's bill off the balance, with why, once per run step. Nothing is recorded for no amount.",
      effect: true,
      inputs: [claimIdPin, pin('adjustedCents', 'integer'), pin('note', 'string')],
      outputs: [],
      compute: async (inputs, _, ctx) => {
        const adjustedCents = centsOf(inputs.adjustedCents, 'The protected amount');
        if (adjustedCents === 0) return {};
        await recovery().protectBalance(ctx.runId, claimIdOf(inputs.claimId), ctx.key, {
          adjustedCents,
          note: requiredText(inputs.note, 'Say why the balance is protected')
        });
        return {};
      }
    }),
    actionNode({
      type: 'billing.skip-remaining-payers',
      title: 'Skip Remaining Payers',
      category: CATEGORY,
      description:
        'Logs every payer on the claim that has not answered yet as skipped, once per run step, so the claim moves on to the patient.',
      effect: true,
      inputs: [claimIdPin, pin('note', 'string', { optional: true })],
      outputs: [],
      compute: async (inputs, _, ctx) => {
        await recovery().skipRemainingPayers(
          ctx.runId,
          claimIdOf(inputs.claimId),
          ctx.key,
          textOrNull(inputs.note) ?? 'Moved to the patient'
        );
        return {};
      }
    }),
    actionNode({
      type: 'billing.build-appeal-packet',
      title: 'Build Appeal Packet',
      category: CATEGORY,
      description:
        'Renders an appeal packet as one PDF: a request letter on the billing profile letterhead, the claim summary, the patient care report and every PDF document on the claim, stores it and logs it in the claim files, once per run step.',
      effect: true,
      inputs: [
        claimIdPin,
        coverageIdPin,
        pin('level', 'string'),
        pin('dueOn', 'datetime', { optional: true })
      ],
      outputs: [],
      compute: async (inputs, _, ctx) => {
        const claimId = claimIdOf(inputs.claimId);
        const coverageId = coverageIdOf(inputs.coverageId);
        const level = requiredText(inputs.level, 'Name the appeal level');
        const dueOn = textOrNull(inputs.dueOn)?.slice(0, 10) ?? null;
        const source = await recovery().appealPacket(ctx.runId, claimId, coverageId);
        const pdf = await renderAppealPacket(
          { ...source, level, dueOn },
          ctx.now.toISOString().slice(0, 10)
        );
        await recovery().saveAppealPacket(ctx.runId, claimId, ctx.key, {
          coverageId,
          note: `${level} packet${dueOn ? `, due by ${dueOn}` : ''}`,
          pdf
        });
        return {};
      }
    }),
    pureNode({
      type: 'billing.with-frequency',
      title: 'Set Claim Frequency',
      category: CATEGORY,
      description:
        'Gives a mapped 837P claim another claim frequency (CLM05-3), such as 8 to void the claim the payer has on file.',
      inputs: [pin('x837', X837_CLAIM.type), pin('frequency', 'string')],
      outputs: [pin('x837', X837_CLAIM.type)],
      compute: ({ x837, frequency }) => ({ x837: { ...recordOf(x837), frequency } })
    })
  ];
};
