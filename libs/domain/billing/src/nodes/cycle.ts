import { actionNode, branchNode, pin } from '@ugula/graph';
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
import { localDate, renderStatement } from '../statements.ts';
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
    actionNode({
      type: 'billing.read-claim-ledger',
      title: 'Read Claim Ledger',
      category: CATEGORY,
      description:
        "Reads where a claim stands from its history (Claim Ledger): its balance, the payer being billed and whether it has the claim or approved it, a payer response waiting to be reconciled, patient approval and statements, and why the last submission was rejected. Also outputs how many claim signals the history already reflects, and the claim's PCR number and patient for people to recognize it by. Decides nothing; Next Claim Step does.",
      inputs: [claimIdPin],
      outputs: [
        pin('ledger', billingTypes.ledger),
        pin('signalsSeen', 'integer'),
        pin('reference', 'string')
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
        'Records the status of the step a claim is on, so the status a biller filters by is always the step the claim is on; a step without a status (closing) records nothing. Continues through stale when the claim changed since its ledger was read, so the next step is decided again.',
      effect: true,
      inputs: [
        claimIdPin,
        pin('status', 'string', { optional: true }),
        pin('signalsSeen', 'integer')
      ],
      outputs: [],
      exits: ['recorded', 'stale'],
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
          inputs.signalsSeen
        );
        return { exit: recorded === 'stale' ? 'stale' : 'recorded', outputs: {} };
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
        "Renders a PDF statement of the claim's charges, payments and balance due, numbered out of the statements the cycle sends and dated in the agency's time zone, stores it and logs it on the claim. Continues through missing, naming what, when the agency has no billing profile or the patient has no complete mailing address.",
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
    branchNode({
      type: 'billing.prepare-837p',
      title: 'Prepare 837P Claim',
      category: CATEGORY,
      description:
        'Loads a claim as it goes to the payer it is being submitted to, ready to map onto an 837P. Continues through stale when that payer is no longer the one being billed or already has the claim.',
      inputs: [claimIdPin, pin('coverageId', 'string')],
      outputs: [pin('claim', billingTypes.submission)],
      exits: ['ready', 'stale'],
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
        'Writes a mapped 837P claim into its own numbered 837P file for the clearinghouse, stores it and logs the claim as submitted (or resubmitted) to the payer, once per run step. Continues through blocked, saying why, when the billing profile is missing or incomplete, the 837P mapping is incomplete or control numbers are used up, and through stale when the claim changed or its payer is no longer the one being billed. The claim checks run before it, in Check Claim.',
      effect: true,
      inputs: [claimIdPin, pin('coverageId', 'string'), pin('x837', billingTypes.x837)],
      outputs: [pin('controlNumber', 'integer'), pin('reason', 'string')],
      exits: ['filed', 'blocked', 'stale'],
      compute: async (inputs, _, ctx) => {
        const claimId = claimIdOf(inputs.claimId);
        const coverageId = requiredText(inputs.coverageId, 'No payer to file the claim with');
        const stale = { exit: 'stale', outputs: { controlNumber: null, reason: null } };
        const blocked = (reason: string) => ({
          exit: 'blocked',
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
        "Uploads a claim's 837P file through the agency's clearinghouse connection (or the server default), once; sending it again does nothing. Continues through manual when no clearinghouse connection is set up, so the biller uploads the file from the claim page.",
      effect: true,
      inputs: [claimIdPin, pin('controlNumber', 'integer')],
      outputs: [pin('sentAs', 'string')],
      exits: ['sent', 'manual'],
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
