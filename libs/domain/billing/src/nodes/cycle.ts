import { actionNode, branchNode, pin } from '@ugula/graph';
import {
  CLOSED_CLAIM_STATUSES,
  claimProgress,
  DEFAULT_POLICY,
  isClosedStatus,
  nextClaimStep,
  PAYER_WAIT_MS,
  STATEMENT_INTERVAL_MS,
  stageOf
} from '../claims.ts';
import { renderStatement } from '../statements.ts';
import { requiredText, textOrNull } from '../values.ts';
import type { CycleEventKind, NodesOf } from './stores.ts';

const CATEGORY = 'Billing';

const DAY_MS = 86_400_000;

const CYCLE_KINDS: readonly string[] = [
  'resubmit_queued',
  'follow_up',
  'payer_skipped',
  'approved',
  'reconciled',
  'statement'
] satisfies CycleEventKind[];

const PAYER_ACTIONS: readonly string[] = [
  'resubmit_queued',
  'follow_up',
  'payer_skipped',
  'approved'
] satisfies CycleEventKind[];

const isCycleKind = (x: string): x is CycleEventKind => CYCLE_KINDS.includes(x);

const claimIdPin = pin('claimId', 'string');

const noClaim = 'No claim to work on';

const daysOr = (days: number, fallbackMs: number) => (days > 0 ? days * DAY_MS : fallbackMs);

export const cycleNodes: NodesOf = (stores) => {
  const claims = () => stores().claims;
  return [
    actionNode({
      type: 'billing.attach-cycle',
      title: 'Attach Claim Cycle',
      category: CATEGORY,
      description:
        'Links a claim to the run that cycles it through payers, so its status can be shown.',
      effect: true,
      inputs: [claimIdPin, pin('cycleRunId', 'string')],
      outputs: [],
      compute: async (inputs, _, ctx) => {
        const claimId = requiredText(inputs.claimId, noClaim);
        const cycleRunId = requiredText(inputs.cycleRunId, 'No cycle run to attach');
        await claims().attachCycle(ctx.runId, claimId, cycleRunId);
        return {};
      }
    }),
    branchNode({
      type: 'billing.claim-step',
      title: 'Claim Step',
      category: CATEGORY,
      description:
        "Decides what a claim needs next from its history and records it as the claim's status: review before the next payer's claim goes out, wait for it to be submitted, wait out the payer's response time, follow up, reconcile a payer's response, send or wait on a patient statement, balance review, or close. Also outputs how many claim signals the history already reflects, and the claim's PCR number and patient for people to recognize it by.",
      effect: true,
      inputs: [
        claimIdPin,
        pin('payerWaitDays', 'number', {
          label: 'Days to wait for a payer',
          default: PAYER_WAIT_MS / DAY_MS
        }),
        pin('statementCount', 'integer', {
          label: 'Patient statements to send',
          default: DEFAULT_POLICY.statementLimit
        }),
        pin('statementIntervalDays', 'number', {
          label: 'Days between statements',
          default: STATEMENT_INTERVAL_MS / DAY_MS
        })
      ],
      outputs: [
        pin('coverageId', 'string'),
        pin('payer', 'string'),
        pin('statementNumber', 'integer'),
        pin('balanceCents', 'integer'),
        pin('waitMs', 'integer'),
        pin('signalsSeen', 'integer'),
        pin('reference', 'string')
      ],
      exits: [
        'review',
        'submit',
        'reconcile',
        'await',
        'followUp',
        'statement',
        'awaitPatient',
        'collections',
        'closed'
      ],
      compute: async (inputs, _, ctx) => {
        const claimId = requiredText(inputs.claimId, noClaim);
        const ledger = await claims().ledger(ctx.runId, claimId);
        if (!ledger) throw new Error(`Claim ${claimId} does not exist`);
        const next = nextClaimStep(ledger, ctx.now, {
          payerWaitMs: daysOr(inputs.payerWaitDays, DEFAULT_POLICY.payerWaitMs),
          statementLimit:
            inputs.statementCount >= 0 ? inputs.statementCount : DEFAULT_POLICY.statementLimit,
          statementIntervalMs: daysOr(
            inputs.statementIntervalDays,
            DEFAULT_POLICY.statementIntervalMs
          )
        });
        const stage = stageOf(next.step);
        if (stage) await claims().setStatus(ctx.runId, claimId, stage);
        return {
          exit: next.step,
          outputs: {
            coverageId: 'coverage' in next ? next.coverage.id : null,
            payer: 'coverage' in next ? next.coverage.payer : null,
            statementNumber: 'statement' in next ? next.statement : null,
            balanceCents: next.balanceCents,
            waitMs: 'waitMs' in next ? next.waitMs : null,
            signalsSeen: ledger.signalsSeen,
            reference: ledger.reference
          }
        };
      }
    }),
    actionNode({
      type: 'billing.record-claim-event',
      title: 'Record Claim Event',
      category: CATEGORY,
      description:
        "Logs a review approval, queued resubmission, follow-up, skipped payer, reconciled response or patient statement on a claim, once per run step. Actions for a payer who has already answered are ignored, except reconciling that payer's response.",
      effect: true,
      inputs: [
        claimIdPin,
        pin('kind', 'string'),
        pin('coverageId', 'string', { optional: true }),
        pin('note', 'string', { optional: true })
      ],
      outputs: [],
      compute: async (inputs, _, ctx) => {
        const claimId = requiredText(inputs.claimId, noClaim);
        const { kind } = inputs;
        if (!isCycleKind(kind)) throw new Error(`Unknown claim event "${kind}"`);
        const coverageId = textOrNull(inputs.coverageId);
        if (PAYER_ACTIONS.includes(kind)) {
          const ledger = await claims().ledger(ctx.runId, claimId);
          if (ledger && claimProgress(ledger).coverage?.id !== coverageId) return {};
        }
        await claims().recordEvent(ctx.runId, claimId, ctx.key, {
          kind,
          coverageId,
          note: textOrNull(inputs.note) ?? ''
        });
        return {};
      }
    }),
    actionNode({
      type: 'billing.issue-statement',
      title: 'Issue Patient Statement',
      category: CATEGORY,
      description:
        "Renders a PDF statement of the claim's charges, payments and balance due, stores it and logs it on the claim. Needs the tenant's billing profile.",
      effect: true,
      inputs: [claimIdPin, pin('statementNumber', 'integer')],
      outputs: [],
      compute: async (inputs, _, ctx) => {
        const claimId = requiredText(inputs.claimId, noClaim);
        const number = inputs.statementNumber;
        if (number < 1) throw new Error('A statement needs a number');
        const store = claims();
        const source = await store.statementData(ctx.runId, claimId);
        const pdf = await renderStatement({
          ...source,
          number,
          issuedOn: ctx.now.toISOString().slice(0, 10)
        });
        await store.saveStatement(ctx.runId, claimId, ctx.key, { number, pdf });
        return {};
      }
    }),
    actionNode({
      type: 'billing.close-claim',
      title: 'Close Claim',
      category: CATEGORY,
      description:
        'Closes a claim as void, written off or sent to collections, or as paid if its balance has reached zero by then.',
      effect: true,
      inputs: [claimIdPin, pin('status', 'string')],
      outputs: [],
      compute: async (inputs, _, ctx) => {
        const claimId = requiredText(inputs.claimId, noClaim);
        const { status } = inputs;
        if (!isClosedStatus(status)) {
          throw new Error(
            `Unknown claim status "${status}"; use ${CLOSED_CLAIM_STATUSES.join(', ')}`
          );
        }
        await claims().closeClaim(ctx.runId, claimId, ctx.key, status);
        return {};
      }
    })
  ];
};
