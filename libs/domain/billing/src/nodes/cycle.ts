import { actionNode, branchNode, pin } from '@ugula/graph';
import { claimIssues, isBlocking } from '../claim-validation.ts';
import {
  CLOSED_CLAIM_STATUSES,
  COVERAGE_EVENT_KINDS,
  type CycleEventKind,
  claimProgress,
  DEFAULT_POLICY,
  isClosedStatus,
  isCycleEventKind,
  nextClaimStep,
  PAYER_WAIT_MS,
  STATEMENT_INTERVAL_MS,
  SUBMIT_WAIT_MS,
  stageOf
} from '../claims.ts';
import { isCompleteAddress } from '../patients.ts';
import { localDate, renderStatement } from '../statements.ts';
import { requiredText, textOrNull } from '../values.ts';
import { checkOf, claimIdOf, claimIdPin, issuesPin, relevantIssues } from './claims.ts';
import type { NodesOf } from './stores.ts';

const CATEGORY = 'Billing';

const DAY_MS = 86_400_000;

const PAYER_ACTIONS: readonly CycleEventKind[] = [
  'submitted',
  'resubmit_queued',
  'follow_up',
  'payer_skipped',
  'approved'
];

const GATED_STEPS: readonly string[] = [
  'review',
  'reviewPatient',
  'confirmPayers',
  'submit',
  'submitDue'
];

const PATIENT_STEPS: readonly string[] = ['reviewPatient', 'confirmPayers'];

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
        const claimId = claimIdOf(inputs.claimId);
        const cycleRunId = requiredText(inputs.cycleRunId, 'No cycle run to attach');
        await claims().attachCycle(ctx.runId, claimId, ctx.key, cycleRunId);

        return {};
      }
    }),
    branchNode({
      type: 'billing.claim-step',
      title: 'Claim Step',
      category: CATEGORY,
      description:
        "Decides what a claim needs next from its history and records it as the claim's status: fix data the claim checks block on before review or submission, review before the next payer's claim goes out, wait for it to be submitted and ask when it sits too long, wait out the payer's response time, follow up, reconcile a payer's response or an overpayment, confirm the payers of a claim without any, review before the first patient statement, send or wait on a patient statement, balance review, or close. Continues through stale when the claim changed while it decided, so it decides again. Also outputs the claim's issues, how many claim signals the history already reflects, and the claim's PCR number and patient for people to recognize it by.",
      effect: true,
      inputs: [
        claimIdPin,
        pin('payerWaitDays', 'number', {
          label: 'Days to wait for a payer',
          default: PAYER_WAIT_MS / DAY_MS
        }),
        pin('submitWaitDays', 'number', {
          label: 'Days a ready claim waits to be submitted',
          default: SUBMIT_WAIT_MS / DAY_MS
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
        pin('statementCount', 'integer'),
        pin('balanceCents', 'integer'),
        pin('waitMs', 'integer'),
        pin('signalsSeen', 'integer'),
        pin('reference', 'string'),
        issuesPin,
        pin('claim', { object: {} })
      ],
      exits: [
        'fix',
        'review',
        'reviewPatient',
        'confirmPayers',
        'submit',
        'submitDue',
        'reconcile',
        'overpaid',
        'await',
        'followUp',
        'statement',
        'awaitPatient',
        'collections',
        'closed',
        'stale'
      ],
      compute: async (inputs, _, ctx) => {
        const claimId = claimIdOf(inputs.claimId);
        const ledger = await claims().ledger(ctx.runId, claimId);
        if (!ledger) throw new Error(`Claim ${claimId} does not exist`);
        const policy = {
          payerWaitMs: daysOr(inputs.payerWaitDays, DEFAULT_POLICY.payerWaitMs),
          submitWaitMs: daysOr(inputs.submitWaitDays, DEFAULT_POLICY.submitWaitMs),
          statementLimit:
            inputs.statementCount >= 0 ? inputs.statementCount : DEFAULT_POLICY.statementLimit,
          statementIntervalMs: daysOr(
            inputs.statementIntervalDays,
            DEFAULT_POLICY.statementIntervalMs
          )
        };
        const next = nextClaimStep(ledger, ctx.now, policy);
        const gated = GATED_STEPS.includes(next.step);
        const claim = gated
          ? checkOf(await claims().claimCheck(ctx.runId, claimId), claimId)
          : null;
        const issues = claim
          ? relevantIssues(claimIssues(claim, ctx.now), ledger, PATIENT_STEPS.includes(next.step))
          : [];
        const exit = gated && isBlocking(issues) ? 'fix' : next.step;
        const { rejection } = claimProgress(ledger);
        const flagged =
          rejection && next.step === 'review'
            ? [
                {
                  level: 'warning' as const,
                  field: 'submission' as const,
                  message: rejection,
                  coverageId: next.coverage.id
                },
                ...issues
              ]
            : issues;
        const stage = stageOf(next.step);
        const recorded = stage
          ? await claims().setStatus(ctx.runId, claimId, ctx.key, stage, ledger.signalsSeen)
          : 'set';
        return {
          exit: recorded === 'stale' ? 'stale' : exit,
          outputs: {
            coverageId: 'coverage' in next ? next.coverage.id : null,
            payer: 'coverage' in next ? next.coverage.payer : null,
            statementNumber: 'statement' in next ? next.statement : null,
            statementCount: policy.statementLimit,
            balanceCents: next.balanceCents,
            waitMs: 'waitMs' in next ? next.waitMs : null,
            signalsSeen: ledger.signalsSeen,
            reference: ledger.reference,
            issues: flagged,
            claim
          }
        };
      }
    }),
    actionNode({
      type: 'billing.record-claim-event',
      title: 'Record Claim Event',
      category: CATEGORY,
      description:
        "Logs a review approval (of a payer, or with no coverage of billing the patient), a submission made outside the app, a queued resubmission, follow-up, skipped payer, reconciled response or patient statement on a claim, once per run step, with the payer's claim number when the payer gave one, so a resubmission replaces that claim. Actions for a payer other than the one being billed are ignored, except reconciling a response or resubmitting a corrected claim to the payer whose response is being reconciled; a submission already on file is not logged twice.",
      effect: true,
      inputs: [
        claimIdPin,
        pin('kind', 'string'),
        pin('coverageId', 'string', { optional: true }),
        pin('note', 'string', { optional: true }),
        pin('payerClaimNumber', 'string', { optional: true })
      ],
      outputs: [],
      compute: async (inputs, _, ctx) => {
        const claimId = claimIdOf(inputs.claimId);
        const { kind } = inputs;
        if (!isCycleEventKind(kind)) throw new Error(`Unknown claim event "${kind}"`);
        const coverageId = textOrNull(inputs.coverageId);
        if (coverageId === null && COVERAGE_EVENT_KINDS.includes(kind)) return {};
        if (PAYER_ACTIONS.includes(kind) && coverageId !== null) {
          const ledger = await claims().ledger(ctx.runId, claimId);
          const p = ledger ? claimProgress(ledger) : null;
          const current = p?.coverage?.id === coverageId;
          const correcting = kind === 'resubmit_queued' && p?.unreconciled?.id === coverageId;
          if (p && !current && !correcting) return {};
          if (kind === 'submitted' && p?.contacted !== null) return {};
        }

        await claims().recordEvent(ctx.runId, claimId, ctx.key, {
          kind,
          coverageId,
          note: textOrNull(inputs.note) ?? '',
          payerClaimNumber: coverageId === null ? null : textOrNull(inputs.payerClaimNumber)
        });
        return {};
      }
    }),
    branchNode({
      type: 'billing.issue-statement',
      title: 'Issue Patient Statement',
      category: CATEGORY,
      description:
        "Renders a PDF statement of the claim's charges, payments and balance due, numbered out of the statements the cycle sends and dated in the agency's time zone, stores it and logs it on the claim. Continues through missing, naming what, when the tenant has no billing profile or the patient has no complete mailing address.",
      effect: true,
      inputs: [
        claimIdPin,
        pin('statementNumber', 'integer'),
        pin('statementCount', 'integer', { label: 'Statements in the cycle' })
      ],
      outputs: [pin('need', 'string')],
      exits: ['issued', 'missing'],
      compute: async (inputs, _, ctx) => {
        const claimId = claimIdOf(inputs.claimId);
        const number = inputs.statementNumber;
        const count = inputs.statementCount;
        if (number < 1 || number > count) {
          throw new Error(`Statement ${number} is not one of the ${count} the cycle sends`);
        }
        const store = claims();
        const { agency, ...source } = await store.statementData(ctx.runId, claimId);
        if (!agency) return { exit: 'missing', outputs: { need: 'profile' } };
        if (!isCompleteAddress(source.patient)) {
          return { exit: 'missing', outputs: { need: 'patientAddress' } };
        }
        const { timeZone, ...from } = agency;
        const pdf = await renderStatement({
          ...source,
          agency: from,
          number,
          count,
          issuedOn: localDate(ctx.now, timeZone)
        });
        await store.saveStatement(ctx.runId, claimId, ctx.key, { number, count, pdf });
        return { exit: 'issued', outputs: { need: null } };
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
        const claimId = claimIdOf(inputs.claimId);
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
