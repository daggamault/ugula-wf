import { actionNode, branchNode, isIsoDate, pin } from '@ugula/graph';
import {
  CLAIM_STATUSES,
  CLOSED_CLAIM_STATUSES,
  type ClaimStatus,
  COVERAGE_EVENT_KINDS,
  type CycleEventKind,
  claimProgress,
  isClosedStatus,
  isCycleEventKind,
  ledgerFactsOf
} from '../claims.ts';
import { billingTypes } from '../models.ts';
import { isCompleteAddress } from '../patients.ts';
import { localDate, renderStatement, type StatementTerms } from '../statements.ts';
import { requiredText, textOrNull } from '../values.ts';
import { build837, readX837Claim, submitterIssues, type X837Claim } from '../x837.ts';
import { claimIdOf, claimIdPin } from './claims.ts';
import type { NodesOf } from './stores.ts';

const CATEGORY = 'Billing';

const PAYER_ACTIONS: readonly CycleEventKind[] = [
  'submitted',
  'resubmit_queued',
  'follow_up',
  'payer_skipped',
  'approved'
];

const isClaimStatus = (x: unknown): x is ClaimStatus => CLAIM_STATUSES.includes(x as ClaimStatus);

const STALE = {
  label: 'Stale',
  description: 'The claim changed meanwhile, so the next step is decided again.'
};

const signalsSeenPin = pin('signalsSeen', 'integer', {
  label: 'Signals Seen',
  description: 'How many claim changes the ledger already reflects.'
});

const coverageIdPin = pin(
  'coverageId',
  { id: 'coverage' },
  {
    label: 'Payer',
    description: 'The payer on the claim the claim is submitted to.'
  }
);

type TermsInputs = {
  statementNumber?: number | null;
  statementCount?: number | null;
  dueCents?: number | null;
  dueOn?: string | null;
};

const statementTermsOf = (inputs: TermsInputs): StatementTerms => {
  const { statementNumber: number, statementCount: count, dueCents, dueOn } = inputs;
  if (dueCents !== null && dueCents !== undefined) {
    if (dueCents <= 0) throw new Error('A payment plan statement needs an installment due');
    if (typeof dueOn !== 'string' || !isIsoDate(dueOn)) {
      throw new Error(`${String(dueOn)} is not a due date`);
    }
    return { dueCents, dueOn };
  }
  if (number === null || number === undefined || count === null || count === undefined) {
    throw new Error('A statement needs its number and count, or an installment due');
  }
  if (number < 1 || number > count) {
    throw new Error(`Statement ${number} is not one of the ${count} the cycle sends`);
  }
  return { number, count };
};

export const cycleNodes: NodesOf = (stores) => {
  const claims = () => stores().claims;
  return [
    actionNode({
      type: 'billing.attach-cycle',
      title: 'Attach Claim Cycle',
      category: CATEGORY,
      description:
        'Links a claim to the run that cycles it through payers, so its status can be shown, and wakes the run to record the status of its step now that the claim is out of draft.',
      level: 'advanced',
      keywords: ['cycle', 'link run'],
      effect: true,
      inputs: [
        claimIdPin,
        pin(
          'cycleRunId',
          { id: 'run' },
          {
            label: 'Cycle Run',
            description: 'The run that cycles the claim through its payers.'
          }
        )
      ],
      outputs: [],
      compute: async (inputs, _, ctx) => {
        const claimId = claimIdOf(inputs.claimId);
        const cycleRunId = requiredText(inputs.cycleRunId, 'No cycle run to attach');
        await claims().attachCycle(ctx.runId, claimId, ctx.key, cycleRunId);

        return {};
      }
    }),
    branchNode({
      type: 'billing.restart-cycle',
      title: 'Restart Claim Cycle',
      category: CATEGORY,
      description:
        'Starts the payer cycle of an open claim again and links the claim to it, unless the claim is a draft, closed or still has an active run besides this one.',
      level: 'advanced',
      keywords: ['cycle', 'restart', 'resume', 'reopen'],
      effect: true,
      inputs: [claimIdPin],
      outputs: [
        pin(
          'cycleRunId',
          { id: 'run' },
          {
            optional: true,
            label: 'Cycle Run',
            description: 'The payer cycle run started, when one was.'
          }
        ),
        pin('reason', 'string', {
          optional: true,
          label: 'Why Not',
          description: 'Why no cycle was started, in words a biller reads.'
        })
      ],
      exits: {
        started: { label: 'Started', description: 'A new payer cycle runs the claim.' },
        skipped: {
          label: 'Skipped',
          description:
            'The claim is a draft, closed or still has an active run, so no cycle was started; Why Not says why.'
        }
      },
      compute: async (inputs, _, ctx) => {
        const restarted = await claims().restartCycle(ctx.runId, claimIdOf(inputs.claimId));
        return restarted.status === 'started'
          ? { exit: 'started', outputs: { cycleRunId: restarted.cycleRunId, reason: null } }
          : { exit: 'skipped', outputs: { cycleRunId: null, reason: restarted.reason } };
      }
    }),
    actionNode({
      type: 'billing.read-claim-ledger',
      title: 'Read Claim Ledger',
      category: CATEGORY,
      description:
        "Reads where a claim stands from its history (Claim Ledger): its balance, the payer being billed and whether it has the claim or approved it, a payer response waiting to be reconciled, patient approval and statements, and why the last submission was rejected. Also gives how many claim changes the history already reflects, and the claim's PCR number and patient for people to recognize it by. Decides nothing; Next Claim Step does.",
      level: 'basic',
      keywords: ['balance', 'status', 'ledger', 'history'],
      inputs: [claimIdPin],
      outputs: [
        pin('ledger', billingTypes.ledger, {
          label: 'Claim Ledger',
          description:
            'Where the claim stands: balance, payer being billed, approvals and statements.'
        }),
        signalsSeenPin,
        pin('reference', 'string', {
          description: "The claim's PCR number and patient, to recognize it by."
        })
      ],
      compute: async (inputs, _, ctx) => {
        const claimId = claimIdOf(inputs.claimId);
        const ledger = await claims().ledger(ctx.runId, claimId);
        if (!ledger) throw new Error(`Claim ${claimId} does not exist`);
        return {
          ledger: ledgerFactsOf(ledger, ctx.now),
          signalsSeen: ledger.signalsSeen,
          reference: ledger.reference
        };
      }
    }),
    branchNode({
      type: 'billing.record-claim-step',
      title: 'Record Claim Step',
      category: CATEGORY,
      description:
        'Records the status of the step a claim is on, so the status a biller filters by is always the step the claim is on, and logs a change of status on the claim history with why; a step without a status (closing) records nothing.',
      level: 'advanced',
      keywords: ['status'],
      effect: true,
      inputs: [
        claimIdPin,
        pin('status', 'string', {
          optional: true,
          description: 'The status of the step the claim is on, if it has one.'
        }),
        signalsSeenPin,
        pin('reason', 'string', {
          optional: true,
          description:
            'Why the claim is on this step, logged on its history when the status changes.'
        })
      ],
      outputs: [],
      exits: {
        recorded: { label: 'Recorded', description: 'The status is recorded.' },
        stale: STALE
      },
      compute: async (inputs, _, ctx) => {
        const claimId = claimIdOf(inputs.claimId);
        const status = textOrNull(inputs.status);
        if (status === null) return { exit: 'recorded', outputs: {} };
        if (!isClaimStatus(status)) throw new Error(`Unknown claim status "${status}"`);
        const recorded = await claims().setStatus(
          ctx.runId,
          claimId,
          ctx.key,
          status,
          inputs.signalsSeen,
          textOrNull(inputs.reason)
        );
        return { exit: recorded === 'stale' ? 'stale' : 'recorded', outputs: {} };
      }
    }),
    actionNode({
      type: 'billing.record-claim-event',
      title: 'Record Claim Event',
      category: CATEGORY,
      description:
        "Logs a review approval (of a payer, or with no payer, of billing the patient), a submission made outside the app, a queued resubmission, follow-up, skipped payer, reconciled response or patient statement on a claim, once per step, with the payer's claim number when the payer gave one, so a resubmission replaces that claim. Actions for a payer other than the one being billed are ignored, except reconciling a response or resubmitting a corrected claim to the payer whose response is being reconciled; a submission already on file is not logged twice.",
      level: 'basic',
      keywords: ['log', 'approve', 'follow up', 'skip payer', 'resubmit'],
      effect: true,
      inputs: [
        claimIdPin,
        pin('kind', 'string', { label: 'Event', description: 'What happened on the claim.' }),
        pin(
          'coverageId',
          { id: 'coverage' },
          {
            optional: true,
            label: 'Payer',
            description: 'The payer on the claim it is about, or none for the patient.'
          }
        ),
        pin('note', 'string', { optional: true, description: 'A note for the claim history.' }),
        pin('payerClaimNumber', 'string', {
          optional: true,
          label: 'Payer Claim Number',
          description: 'The number the payer gave the claim, if any.'
        })
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
          if (kind === 'submitted' && p && p.contacted !== null) return {};
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
    actionNode({
      type: 'billing.record-decision',
      title: 'Record Decision',
      category: CATEGORY,
      description:
        "Logs a decision on the claim's history with why it was made, such as how the trip was classified or which patient the report was matched to, once per step. Decided By names the person when a task decided it; a rule's decision is logged as automatic. A completed task on the claim logs its own outcome, so this is for what rules decide and for the meaning of a task's answer.",
      level: 'basic',
      keywords: ['log', 'audit', 'decision', 'reason', 'history', 'why'],
      effect: true,
      inputs: [
        claimIdPin,
        pin('decision', 'string', { description: 'What was decided, as a short sentence.' }),
        pin('reason', 'string', { optional: true, description: 'Why it was decided.' }),
        pin('decidedBy', 'string', {
          optional: true,
          label: 'Decided By',
          description: 'The user whose task decided it, or nothing when a rule did.'
        })
      ],
      outputs: [],
      compute: async (inputs, _, ctx) => {
        const decision = requiredText(inputs.decision, 'A decision needs to say what was decided');
        const reason = textOrNull(inputs.reason);
        await claims().recordDecision(ctx.runId, claimIdOf(inputs.claimId), ctx.key, {
          note: reason ? `${decision} · ${reason}` : decision,
          decidedBy: textOrNull(inputs.decidedBy)
        });
        return {};
      }
    }),
    branchNode({
      type: 'billing.issue-statement',
      title: 'Issue Patient Statement',
      category: CATEGORY,
      description:
        "Renders a PDF statement of the claim's charges, payments and balance due, numbered out of the statements the cycle sends, or for a payment plan asking for the installment due by its date, dated in the agency's time zone, stores it and logs it on the claim.",
      level: 'basic',
      keywords: ['statement', 'patient bill', 'invoice', 'self pay'],
      effect: true,
      inputs: [
        claimIdPin,
        pin('statementNumber', 'integer', {
          optional: true,
          label: 'Statement',
          description: 'Which statement of the cycle this is, unless it asks for an installment.'
        }),
        pin('statementCount', 'integer', {
          optional: true,
          label: 'Statements in the Cycle',
          description: 'How many statements the cycle sends.'
        }),
        pin('dueCents', 'integer', {
          optional: true,
          label: 'Installment Due (Cents)',
          description: 'For a payment plan statement, the installment it asks the patient to pay.'
        }),
        pin('dueOn', 'string', {
          optional: true,
          label: 'Installment Due On',
          description: 'For a payment plan statement, the date the installment is due (YYYY-MM-DD).'
        })
      ],
      outputs: [
        pin('need', 'string', {
          label: 'Missing',
          description: 'What is missing: the billing profile or the patient address.'
        })
      ],
      exits: {
        issued: { label: 'Issued', description: 'The statement was made and logged on the claim.' },
        missing: {
          label: 'Missing',
          description:
            'The agency has no billing profile or the patient has no complete mailing address.'
        }
      },
      compute: async (inputs, _, ctx) => {
        const claimId = claimIdOf(inputs.claimId);
        const terms = statementTermsOf(inputs);
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
          terms,
          issuedOn: localDate(ctx.now, timeZone)
        });
        await store.saveStatement(ctx.runId, claimId, ctx.key, { terms, pdf });
        return { exit: 'issued', outputs: { need: null } };
      }
    }),
    branchNode({
      type: 'billing.prepare-837p',
      title: 'Prepare 837P Claim',
      category: CATEGORY,
      description:
        'Loads a claim as it goes to the payer it is being submitted to, ready to map onto an 837P.',
      level: 'basic',
      keywords: ['submit', 'electronic claim', 'x12'],
      inputs: [claimIdPin, coverageIdPin],
      outputs: [
        pin('claim', billingTypes.submission, {
          description: 'The claim as it goes to the payer.'
        })
      ],
      exits: {
        ready: { label: 'Ready', description: 'The claim is ready to map onto an 837P.' },
        stale: {
          label: 'Stale',
          description: 'The payer is no longer the one being billed or already has the claim.'
        }
      },
      compute: async (inputs, _, ctx) => {
        const { pending } = await claims().submission(
          ctx.runId,
          claimIdOf(inputs.claimId),
          requiredText(inputs.coverageId, 'No payer to submit the claim to')
        );
        return pending
          ? { exit: 'ready', outputs: { claim: pending.claim } }
          : { exit: 'stale', outputs: { claim: null } };
      }
    }),
    branchNode({
      type: 'billing.file-837p',
      title: 'File 837P Claim',
      category: CATEGORY,
      description:
        'Writes a mapped 837P claim into its own numbered 837P file for the clearinghouse, stores it and logs the claim as submitted (or resubmitted) to the payer, once per step. The claim checks run before it, in Check Claim.',
      level: 'basic',
      keywords: ['submit', 'electronic claim', 'x12', 'file'],
      effect: true,
      inputs: [
        claimIdPin,
        coverageIdPin,
        pin('x837', billingTypes.x837, {
          label: '837P Claim',
          description: 'The claim mapped onto the 837P.'
        })
      ],
      outputs: [
        pin('controlNumber', 'integer', {
          label: 'Control Number',
          description: 'The number of the 837P file written.'
        }),
        pin('reason', 'string', { description: 'Why the claim could not be filed.' })
      ],
      exits: {
        filed: { label: 'Filed', description: 'The 837P file is written and the claim submitted.' },
        blocked: {
          label: 'Blocked',
          description:
            'The billing profile or 837P mapping is incomplete, or control numbers are used up; the reason says why.'
        },
        stale: {
          label: 'Stale',
          description: 'The claim changed or its payer is no longer the one being billed.'
        }
      },
      compute: async (inputs, _, ctx) => {
        const claimId = claimIdOf(inputs.claimId);
        const coverageId = requiredText(inputs.coverageId, 'No payer to file the claim with');
        const stale = { exit: 'stale' as const, outputs: { controlNumber: null, reason: null } };
        const blocked = (reason: string) => ({
          exit: 'blocked' as const,
          outputs: { controlNumber: null, reason }
        });
        const { submitter, pending } = await claims().submission(ctx.runId, claimId, coverageId);
        if (pending?.coverageId !== coverageId) return stale;
        const problems = submitterIssues(submitter);
        if (!submitter || problems.length) return blocked(problems.join('; '));
        let x837: X837Claim;
        try {
          x837 = readX837Claim(inputs.x837);
        } catch (err) {
          return blocked(
            `The 837P mapping is incomplete: ${err instanceof Error ? err.message : String(err)}`
          );
        }
        const saved = await claims().saveSubmission(ctx.runId, claimId, ctx.key, {
          coverageId,
          resubmission: pending.resubmission,
          totalCents: pending.totalCents,
          production: submitter.production,
          build: (controlNumber) =>
            build837(submitter, [x837], { controlNumber, createdAt: ctx.now })
        });
        if (saved === 'stale') return stale;
        if (saved === 'exhausted') {
          return blocked('Batch control numbers are used up; contact support');
        }
        return { exit: 'filed', outputs: { controlNumber: saved.controlNumber, reason: null } };
      }
    }),
    actionNode({
      type: 'billing.follow-claim',
      title: 'Follow Claim',
      category: CATEGORY,
      description:
        "Links this run to a claim, so its tasks and problems show on the claim and the claim's tasks list. A run follows one claim.",
      level: 'basic',
      keywords: ['link', 'claim tasks'],
      effect: true,
      inputs: [claimIdPin],
      outputs: [],
      compute: async (inputs, _, ctx) => {
        await claims().linkRun(ctx.runId, claimIdOf(inputs.claimId));
        return {};
      }
    }),
    branchNode({
      type: 'billing.send-837p',
      title: 'Send 837P to Clearinghouse',
      category: CATEGORY,
      description:
        "Uploads a claim's 837P file through the agency's clearinghouse connection (or the server default), once; sending it again does nothing.",
      level: 'basic',
      keywords: ['submit', 'upload', 'clearinghouse', 'send claim'],
      effect: true,
      inputs: [
        claimIdPin,
        pin('controlNumber', 'integer', {
          label: 'Control Number',
          description: 'The number of the 837P file to send.'
        })
      ],
      outputs: [
        pin('sentAs', 'string', {
          label: 'Sent As',
          description: 'The name the file was sent under.'
        })
      ],
      exits: {
        sent: { label: 'Sent', description: 'The file was sent to the clearinghouse.' },
        manual: {
          label: 'Manual',
          description:
            'No clearinghouse connection is set up, so the biller uploads the file from the claim page.'
        }
      },
      compute: async (inputs, _, ctx) => {
        const sent = await claims().sendClaimFile(
          ctx.runId,
          claimIdOf(inputs.claimId),
          inputs.controlNumber
        );
        return sent === 'manual'
          ? { exit: 'manual', outputs: { sentAs: null } }
          : { exit: 'sent', outputs: { sentAs: sent.sentAs } };
      }
    }),
    actionNode({
      type: 'billing.close-claim',
      title: 'Close Claim',
      category: CATEGORY,
      description:
        'Closes a claim as void, written off or sent to collections, or as paid if its balance has reached zero by then.',
      level: 'basic',
      keywords: ['void', 'write off', 'collections', 'close'],
      effect: true,
      inputs: [
        claimIdPin,
        pin('status', 'string', {
          description: 'How to close the claim: void, written off or collections.'
        })
      ],
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
