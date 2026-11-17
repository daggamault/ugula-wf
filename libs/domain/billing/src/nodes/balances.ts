import { actionNode, branchNode, isIsoDate, pin } from '@ugula/graph';
import { money } from '../numbers.ts';
import { isEndedPlanStatus, MAX_PLAN_INTERVAL_DAYS } from '../payment-plans.ts';
import { requiredText, textOrNull } from '../values.ts';
import { claimIdOf, claimIdPin } from './claims.ts';
import type { NodesOf, Refused } from './stores.ts';

const CATEGORY = 'Billing';

const reasonPin = pin('reason', 'string', {
  optional: true,
  label: 'Why Not',
  description: 'Why it was refused, in words a biller reads.'
});

const REFUSED = { label: 'Refused', description: 'Nothing was saved; Why Not says why.' };

const refused = (reason: string): Refused => ({ status: 'refused', reason });

const notePin = pin('note', 'string', {
  optional: true,
  description: 'A note for the claim history.'
});

export const planTermsProblem = (t: {
  installmentCents: number;
  intervalDays: number;
  firstDueOn: string | null | undefined;
}) => {
  if (t.installmentCents <= 0) return 'The installment must be more than $0.00';
  if (t.intervalDays < 1 || t.intervalDays > MAX_PLAN_INTERVAL_DAYS) {
    return `Installments are 1 to ${MAX_PLAN_INTERVAL_DAYS} days apart`;
  }
  if (!t.firstDueOn || !isIsoDate(t.firstDueOn)) return 'The first due date is not a date';
  return null;
};

export const balanceNodes: NodesOf = (stores) => {
  const balances = () => stores().balances;
  return [
    branchNode({
      type: 'billing.start-payment-plan',
      title: 'Start Payment Plan',
      category: CATEGORY,
      description:
        'Saves a payment plan on a claim, the installment due every so many days from a first due date, logs it on the claim history and signals the claim so its cycle bills the installments. A claim has at most one active plan.',
      level: 'basic',
      keywords: ['payment plan', 'installments', 'patient balance'],
      effect: true,
      inputs: [
        claimIdPin,
        pin('installmentCents', 'integer', {
          label: 'Installment (Cents)',
          description: 'What the patient pays each time.'
        }),
        pin('intervalDays', 'integer', {
          label: 'Days Between Installments',
          description: 'How many days apart installments are due.'
        }),
        pin('firstDueOn', 'string', {
          label: 'First Due On',
          description: 'The date the first installment is due (YYYY-MM-DD).'
        }),
        pin('createdBy', 'string', {
          optional: true,
          label: 'Set Up By',
          description: 'The user who set up the plan.'
        })
      ],
      outputs: [reasonPin],
      exits: {
        started: { label: 'Started', description: 'The plan is active.' },
        refused: REFUSED
      },
      compute: async (inputs, _, ctx) => {
        const problem = planTermsProblem(inputs);
        const started = problem
          ? refused(problem)
          : await balances().startPlan(ctx.runId, claimIdOf(inputs.claimId), ctx.key, {
              installmentCents: inputs.installmentCents,
              intervalDays: inputs.intervalDays,
              firstDueOn: inputs.firstDueOn,
              createdBy: textOrNull(inputs.createdBy)
            });
        return started.status === 'started'
          ? { exit: 'started', outputs: { reason: null } }
          : { exit: 'refused', outputs: { reason: started.reason } };
      }
    }),
    actionNode({
      type: 'billing.record-plan-miss',
      title: 'Record Missed Installment',
      category: CATEGORY,
      description:
        "Counts a missed installment on the claim's active payment plan and logs it, so the plan moves on to the next installment; nothing happens without an active plan.",
      level: 'basic',
      keywords: ['payment plan', 'missed payment'],
      effect: true,
      inputs: [claimIdPin, notePin],
      outputs: [],
      compute: async (inputs, _, ctx) => {
        await balances().missPlan(
          ctx.runId,
          claimIdOf(inputs.claimId),
          ctx.key,
          textOrNull(inputs.note) ?? 'Installment missed; the plan was kept'
        );
        return {};
      }
    }),
    actionNode({
      type: 'billing.end-payment-plan',
      title: 'End Payment Plan',
      category: CATEGORY,
      description:
        "Ends the claim's active payment plan as completed, defaulted or cancelled and logs it; the claim then goes back to statements and collections. Nothing happens without an active plan.",
      level: 'basic',
      keywords: ['payment plan', 'default', 'cancel'],
      effect: true,
      inputs: [
        claimIdPin,
        pin('status', 'string', {
          description: 'How the plan ends: completed, defaulted or cancelled.'
        }),
        notePin
      ],
      outputs: [],
      compute: async (inputs, _, ctx) => {
        const { status } = inputs;
        if (!isEndedPlanStatus(status)) {
          throw new Error(`Unknown plan ending "${status}"; use completed, defaulted or cancelled`);
        }
        await balances().endPlan(ctx.runId, claimIdOf(inputs.claimId), ctx.key, {
          status,
          note: textOrNull(inputs.note) ?? `Payment plan ${status}`
        });
        return {};
      }
    }),
    actionNode({
      type: 'billing.record-collections-placement',
      title: 'Record Collections Placement',
      category: CATEGORY,
      description:
        "Places a claim sent to collections with the collection agency: records the placement with the agency's fee, adds the claim to the day's placement file (CSV) stored with the claim files, and logs it on the claim. A claim already placed is left alone.",
      level: 'basic',
      keywords: ['collections', 'placement', 'collection agency', 'export'],
      effect: true,
      inputs: [
        claimIdPin,
        pin('agencyName', 'string', {
          label: 'Collection Agency',
          description: 'The collection agency the claim is placed with.'
        }),
        pin('feePct', 'number', {
          label: 'Fee (%)',
          description: 'The share of what it recovers the collection agency keeps.'
        })
      ],
      outputs: [],
      compute: async (inputs, _, ctx) => {
        const agencyName = requiredText(inputs.agencyName, 'No collection agency to place with');
        if (inputs.feePct < 0 || inputs.feePct > 100) {
          throw new Error(`A fee of ${inputs.feePct}% is not between 0 and 100`);
        }
        await balances().placeCollections(ctx.runId, claimIdOf(inputs.claimId), ctx.key, {
          agencyName,
          feePct: inputs.feePct
        });
        return {};
      }
    }),
    actionNode({
      type: 'billing.credit-targets',
      title: 'Credit Transfer Choices',
      category: CATEGORY,
      description:
        "Lists the patient's other open claims with a balance as choices for a task's claim field, to move a credit to.",
      level: 'basic',
      keywords: ['credit', 'transfer', 'choices'],
      inputs: [claimIdPin],
      outputs: [
        pin(
          'options',
          { object: {} },
          {
            label: 'Choices',
            description: "The patient's other open claims, for the To Claim field of a task."
          }
        )
      ],
      compute: async (inputs, _, ctx) => {
        const targets = await balances().creditTargets(ctx.runId, claimIdOf(inputs.claimId));
        return {
          options: targets.length
            ? {
                toClaimId: targets.map((t) => ({
                  value: t.claimId,
                  label: `${t.reference} · ${money(t.balanceCents)} open`
                }))
              }
            : null
        };
      }
    }),
    branchNode({
      type: 'billing.transfer-credit',
      title: 'Transfer Credit',
      category: CATEGORY,
      description:
        "Moves a claim's credit balance to another open claim of the same patient as a pair of ledger entries, never more than the credit or what the other claim still owes, and signals both claims.",
      level: 'basic',
      keywords: ['credit', 'transfer', 'overpayment', 'refund'],
      effect: true,
      inputs: [
        claimIdPin,
        pin(
          'toClaimId',
          { id: 'claim' },
          {
            optional: true,
            label: 'To Claim',
            description: 'The open claim of the same patient to move it to.'
          }
        ),
        notePin
      ],
      outputs: [
        pin('transferredCents', 'integer', {
          optional: true,
          label: 'Transferred (Cents)',
          description: 'How much was moved.'
        }),
        reasonPin
      ],
      exits: {
        transferred: { label: 'Transferred', description: 'The credit was moved.' },
        refused: REFUSED
      },
      compute: async (inputs, _, ctx) => {
        const toClaimId = textOrNull(inputs.toClaimId);
        const moved = toClaimId
          ? await balances().transferCredit(ctx.runId, claimIdOf(inputs.claimId), ctx.key, {
              toClaimId,
              note: textOrNull(inputs.note) ?? ''
            })
          : refused('Choose the claim to move the credit to');
        return moved.status === 'transferred'
          ? { exit: 'transferred', outputs: { transferredCents: moved.cents, reason: null } }
          : { exit: 'refused', outputs: { transferredCents: null, reason: moved.reason } };
      }
    })
  ];
};
