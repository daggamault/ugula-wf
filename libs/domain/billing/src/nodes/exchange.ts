import { actionNode, branchNode, pin } from '@ugula/graph';
import { claimProgress } from '../claims.ts';
import { requiredText } from '../values.ts';
import { claimIdOf, claimIdPin } from './claims.ts';
import { PAYER_FILE_LINE } from './payer-files.ts';
import type { NodesOf } from './stores.ts';

const CATEGORY = 'Billing';

export const exchangeNodes: NodesOf = (stores) => [
  branchNode({
    type: 'billing.send-270',
    title: 'Check Eligibility with Clearinghouse',
    category: CATEGORY,
    description:
      "Asks the clearinghouse whether each payer on a claim with a directory payer and member ID covers the patient on the date of service. Unless forced, a payer that already has an answer or a request waiting for one is not asked again, and an answer for the same patient, payer and member ID in the same month of service on another claim is reused. Sends a real-time 270 when the agency's connection supports it and applies the 271 answer at once (an inactive coverage blocks billing that payer), outputting the lines a biller has to look at, such as a Medicare answer that names a Medicare Advantage plan. Otherwise, or when the real-time request gets no answer, uploads a batch 270 whose 271 arrives with the payer files; a real-time answer that cannot be read is not asked again in batch. Continues through unavailable, saying why, without a connection, billing profile or payer to check.",
    effect: true,
    inputs: [claimIdPin, pin('force', 'boolean', { optional: true })],
    outputs: [
      pin('fileName', 'string'),
      pin('reviews', { list: PAYER_FILE_LINE }),
      pin('sentAs', 'string'),
      pin('reason', 'string')
    ],
    exits: ['answered', 'sent', 'unavailable'],
    compute: async (inputs, _, ctx) => {
      const r = await stores().exchange.checkEligibility(
        ctx.runId,
        claimIdOf(inputs.claimId),
        ctx.key,
        inputs.force === true
      );
      const none = { fileName: null, reviews: [], sentAs: null, reason: null };
      switch (r.status) {
        case 'answered':
          return {
            exit: 'answered',
            outputs: { ...none, fileName: r.fileName, reviews: r.reviews }
          };
        case 'sent':
          return { exit: 'sent', outputs: { ...none, sentAs: r.sentAs, reason: r.reason } };
        case 'unavailable':
          return { exit: 'unavailable', outputs: { ...none, reason: r.reason } };
      }
    }
  }),
  branchNode({
    type: 'billing.send-276',
    title: 'Check Claim Status with Clearinghouse',
    category: CATEGORY,
    description:
      "Asks the payer through the clearinghouse where a submitted claim stands (276). Sends it in real time when the agency's connection supports it and logs the 277 answer on the claim; otherwise, or when the real-time request gets no answer, uploads a batch 276 whose 277 is logged when it arrives, and outputs how many claim signals were seen so a wait can start from there. A real-time answer that does not name the claim is not asked again in batch, and a retried step returns what it already sent instead of asking again. Continues through unavailable, saying why, without a connection, billing profile or submission to ask about.",
    effect: true,
    inputs: [claimIdPin, pin('coverageId', 'string')],
    outputs: [
      pin('status', 'string'),
      pin('sentAs', 'string'),
      pin('signalsSeen', 'integer'),
      pin('reason', 'string')
    ],
    exits: ['answered', 'sent', 'unavailable'],
    compute: async (inputs, _, ctx) => {
      const r = await stores().exchange.checkClaimStatus(
        ctx.runId,
        claimIdOf(inputs.claimId),
        ctx.key,
        requiredText(inputs.coverageId, 'No payer to ask about the claim')
      );
      const none = { status: null, sentAs: null, signalsSeen: null, reason: null };
      switch (r.status) {
        case 'answered':
          return { exit: 'answered', outputs: { ...none, status: r.note } };
        case 'sent':
          return {
            exit: 'sent',
            outputs: { ...none, sentAs: r.sentAs, signalsSeen: r.signalsSeen, reason: r.reason }
          };
        case 'unavailable':
          return { exit: 'unavailable', outputs: { ...none, reason: r.reason } };
      }
    }
  }),
  actionNode({
    type: 'billing.latest-claim-status',
    title: 'Latest Claim Status',
    category: CATEGORY,
    description:
      'The latest claim status the payer gave (277) for the payer being billed since the claim was last sent or followed up, or nothing.',
    inputs: [claimIdPin],
    outputs: [pin('status', 'string')],
    compute: async (inputs, _, ctx) => {
      const claimId = claimIdOf(inputs.claimId);
      const ledger = await stores().claims.ledger(ctx.runId, claimId);
      if (!ledger) throw new Error(`Claim ${claimId} does not exist`);
      return { status: claimProgress(ledger).claimStatus };
    }
  })
];
