import { actionNode, pin, pureNode } from '@ugula/graph';
import { renderAppealPacket } from '../documents.ts';
import { DENIAL_FACTS, PATIENT_BALANCE_FACTS, REFUND_FACTS } from '../ledger-models.ts';
import {
  appealOutcomeOf,
  denialFactsOf,
  patientBalanceFactsOf,
  payerFactsOf,
  refundFactsOf,
  responseFactsOf
} from '../recovery.ts';
import { X837_CLAIM } from '../submission-models.ts';
import { isCents, recordOf, requiredText, textOrNull } from '../values.ts';
import { claimIdOf, claimIdPin } from './claims.ts';
import type { NodesOf } from './stores.ts';

const CATEGORY = 'Billing';

const coverageIdPin = pin(
  'coverageId',
  { id: 'coverage' },
  {
    label: 'Payer',
    description: 'The payer on the claim this step is about.'
  }
);

const payerOrPatientPin = pin(
  'coverageId',
  { id: 'coverage' },
  {
    optional: true,
    label: 'Payer',
    description: 'The payer on the claim, or none for the patient.'
  }
);

const notePin = pin('note', 'string', {
  optional: true,
  description: 'A note for the claim history.'
});

const coverageIdOf = (x: unknown) => requiredText(x, 'No payer to work on');

const centsOf = (x: unknown, what: string) => {
  if (!isCents(x)) throw new Error(`${what} must be a whole number of cents`);
  return x;
};

export const recoveryNodes: NodesOf = (stores) => {
  const claims = () => stores().claims;
  const recovery = () => stores().recovery;
  const today = (runId: string, at: Date) => stores().calendar.today(runId, at);
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
      level: 'basic',
      keywords: ['denial', 'denied', 'reason codes'],
      inputs: [claimIdPin, coverageIdPin],
      outputs: [
        pin('denial', DENIAL_FACTS.type, {
          label: 'Denial Facts',
          description: 'The denial as the denial rules read it.'
        })
      ],
      compute: async (inputs, _, ctx) => ({
        denial: denialFactsOf(
          await ledgerOf(ctx.runId, claimIdOf(inputs.claimId)),
          coverageIdOf(inputs.coverageId)
        )
      })
    }),
    actionNode({
      type: 'billing.read-payer-response',
      title: 'Read Payer Response',
      category: CATEGORY,
      description:
        "Adds up every response one payer sent on a claim: what it paid, the patient's share of the allowed amount it stated (deductible, coinsurance and copay: PR-1, PR-2, PR-3), what it allowed (paid, plus that share, plus Medicare sequestration, CO-253) and whether it sent reason codes at all (a payment posted by hand may have none). Decides nothing.",
      level: 'basic',
      keywords: ['allowed', 'paid', 'deductible', 'coinsurance', 'copay'],
      inputs: [claimIdPin, coverageIdPin],
      outputs: [
        pin('paidCents', 'integer', {
          label: 'Paid (Cents)',
          description: 'What the payer paid in all, in cents.'
        }),
        pin('patientCents', 'integer', {
          label: "Patient's Share (Cents)",
          description: 'The deductible, coinsurance and copay the payer stated, in cents.'
        }),
        pin('allowedCents', 'integer', {
          label: 'Allowed (Cents)',
          description: 'What the payer allowed, in cents.'
        }),
        pin('reasonCoded', 'boolean', {
          label: 'Sent Reason Codes',
          description: 'Whether the payer sent reason codes at all.'
        })
      ],
      compute: async (inputs, _, ctx) =>
        responseFactsOf(
          await ledgerOf(ctx.runId, claimIdOf(inputs.claimId)),
          coverageIdOf(inputs.coverageId)
        )
    }),
    actionNode({
      type: 'billing.read-payer',
      title: 'Read Payer',
      category: CATEGORY,
      description:
        'Reads the name and claim filing indicator of one payer on a claim, or patient when no payer is given. Decides nothing.',
      level: 'basic',
      keywords: ['payer name', 'plan type', 'claim filing'],
      inputs: [claimIdPin, payerOrPatientPin],
      outputs: [
        pin('payer', 'string', { description: 'The payer name, or patient.' }),
        pin('payerKind', 'string', {
          label: 'Payer Kind',
          description: 'The claim filing indicator of the payer, or patient.'
        })
      ],
      compute: async (inputs, _, ctx) =>
        payerFactsOf(
          await ledgerOf(ctx.runId, claimIdOf(inputs.claimId)),
          textOrNull(inputs.coverageId)
        )
    }),
    actionNode({
      type: 'billing.read-appeal',
      title: 'Read Appeal Outcome',
      category: CATEGORY,
      description:
        'Reads whether the payer answered the last appeal on a claim with a new remittance, what it paid and whether it denied again, with how many claim changes the history reflects. Decides nothing; Appeal Decision does.',
      level: 'basic',
      keywords: ['appeal', 'reconsideration'],
      inputs: [claimIdPin, coverageIdPin],
      outputs: [
        pin('decided', 'boolean', { description: 'Whether the payer answered the appeal.' }),
        pin('paidCents', 'integer', {
          label: 'Paid (Cents)',
          description: 'What the payer paid on the appeal, in cents.'
        }),
        pin('deniedAgain', 'boolean', {
          label: 'Denied Again',
          description: 'Whether the payer denied the claim again.'
        }),
        pin('balanceCents', 'integer', {
          label: 'Balance (Cents)',
          description: 'The claim balance, in cents.'
        }),
        pin('signalsSeen', 'integer', {
          label: 'Signals Seen',
          description: 'How many claim changes the history reflects.'
        })
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
      level: 'basic',
      keywords: ['overpayment', 'credit balance', 'refund'],
      inputs: [claimIdPin],
      outputs: [
        pin('refund', REFUND_FACTS.type, {
          label: 'Refund Facts',
          description: 'The credit balance as the refund rules read it.'
        })
      ],
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
      level: 'basic',
      keywords: ['patient responsibility', 'self pay', 'balance'],
      inputs: [claimIdPin],
      outputs: [
        pin('patientBalance', PATIENT_BALANCE_FACTS.type, {
          label: 'Patient Balance Facts',
          description: 'What is left for the patient, as the patient rules read it.'
        })
      ],
      compute: async (inputs, _, ctx) => ({
        patientBalance: patientBalanceFactsOf(await ledgerOf(ctx.runId, claimIdOf(inputs.claimId)))
      })
    }),
    actionNode({
      type: 'billing.record-refund',
      title: 'Record Refund',
      category: CATEGORY,
      description:
        'Records a refund on the claim ledger, paid back to a payer on the claim or to the patient when no payer is given, once per step. Refunding more than was paid is an error.',
      level: 'basic',
      keywords: ['refund', 'overpayment', 'pay back'],
      effect: true,
      inputs: [
        claimIdPin,
        payerOrPatientPin,
        pin('amountCents', 'integer', {
          label: 'Amount (Cents)',
          description: 'The amount refunded, in cents.'
        }),
        notePin
      ],
      outputs: [],
      compute: async (inputs, _, ctx) => {
        await recovery().recordRefund(ctx.runId, claimIdOf(inputs.claimId), ctx.key, {
          coverageId: textOrNull(inputs.coverageId),
          cents: centsOf(inputs.amountCents, 'The refund'),
          note: textOrNull(inputs.note) ?? 'Refund of a credit balance',
          paidOn: await today(ctx.runId, ctx.now)
        });
        return {};
      }
    }),
    actionNode({
      type: 'billing.protect-balance',
      title: 'Protect Patient Balance',
      category: CATEGORY,
      description:
        "Takes what state balance-billing law keeps off the patient's bill off the balance, with why, once per step. Nothing is recorded for no amount.",
      level: 'basic',
      keywords: ['balance billing', 'adjustment', 'surprise billing'],
      effect: true,
      inputs: [
        claimIdPin,
        pin('adjustedCents', 'integer', {
          label: 'Protected (Cents)',
          description: 'The amount kept off the patient bill, in cents.'
        }),
        pin('note', 'string', { description: 'Why the balance is protected.' })
      ],
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
        'Logs every payer on the claim that has not answered yet as skipped, once per step, so the claim moves on to the patient.',
      level: 'basic',
      keywords: ['skip', 'bill patient', 'self pay'],
      effect: true,
      inputs: [claimIdPin, notePin],
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
      type: 'billing.add-payer',
      title: 'Add Payer',
      category: CATEGORY,
      description:
        'Adds a directory payer to the end of the claim payers, with the member ID, so the claim cycle bills it after the payers before it; a payer and member already on the claim are left alone.',
      level: 'basic',
      keywords: ['insurance', 'coverage', 'new payer'],
      effect: true,
      inputs: [
        claimIdPin,
        pin(
          'payerId',
          { id: 'payer' },
          {
            label: 'Payer',
            description: 'The directory payer to bill.'
          }
        ),
        pin('memberId', 'string', {
          optional: true,
          label: 'Member ID',
          description: 'The member ID of the patient with that payer.'
        })
      ],
      outputs: [],
      compute: async (inputs, _, ctx) => {
        await recovery().addPayer(ctx.runId, claimIdOf(inputs.claimId), {
          payerId: requiredText(inputs.payerId, 'Choose the payer to bill'),
          memberId: textOrNull(inputs.memberId)
        });
        return {};
      }
    }),
    actionNode({
      type: 'billing.build-appeal-packet',
      title: 'Build Appeal Packet',
      category: CATEGORY,
      description:
        'Renders an appeal packet as one PDF: a request letter on the billing profile letterhead, the claim summary, the patient care report and every PDF document on the claim, stores it and logs it in the claim files, once per step.',
      level: 'basic',
      keywords: ['appeal', 'letter', 'pdf', 'reconsideration'],
      effect: true,
      inputs: [
        claimIdPin,
        coverageIdPin,
        pin('level', 'string', {
          description: 'The appeal level, such as Redetermination.'
        }),
        pin('dueOn', 'datetime', {
          optional: true,
          label: 'Due On',
          description: 'When the payer must receive the appeal.'
        })
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
          await today(ctx.runId, ctx.now)
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
        'Gives a mapped 837P claim another claim frequency (CLM05-3), such as 8 to void the claim the payer has on file, or keeps its own when none is given.',
      level: 'advanced',
      keywords: ['void', 'replace', 'frequency code', 'clm05'],
      inputs: [
        pin('x837', X837_CLAIM.type, {
          label: '837P Claim',
          description: 'The claim mapped onto the 837P.'
        }),
        pin('frequency', 'string', {
          optional: true,
          description: 'The claim frequency code to use, such as 7 to replace or 8 to void.'
        })
      ],
      outputs: [
        pin('x837', X837_CLAIM.type, {
          label: '837P Claim',
          description: 'The claim with the frequency set.'
        })
      ],
      compute: ({ x837, frequency }) => ({
        x837: frequency === null ? x837 : { ...recordOf(x837), frequency }
      })
    })
  ];
};
