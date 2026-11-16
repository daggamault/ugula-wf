import { actionNode, branchNode, pin } from '@ugula/graph';
import { claimProgress } from '../claims.ts';
import { requiredText } from '../values.ts';
import { claimIdOf, claimIdPin } from './claims.ts';
import { PAYER_FILE_LINE } from './payer-files.ts';
import type { NodesOf } from './stores.ts';

const CATEGORY = 'Billing';

const sentAsPin = pin('sentAs', 'string', {
  label: 'Sent As',
  description: 'How the request was sent: realtime or the batch file name.'
});

const reasonPin = pin('reason', 'string', {
  description: 'Why the request could not be sent or answered at once.'
});

const UNAVAILABLE = {
  label: 'Unavailable',
  description:
    'Nothing was asked: there is no clearinghouse connection, billing profile or payer to ask; the reason says which.'
};

export const exchangeNodes: NodesOf = (stores) => [
  branchNode({
    type: 'billing.send-270',
    title: 'Check Eligibility with Clearinghouse',
    category: CATEGORY,
    description:
      "Asks the clearinghouse whether each payer on a claim with a directory payer and member ID covers the patient on the date of service. Unless forced, a payer that already has an answer or a request waiting for one is not asked again, and an answer for the same patient, payer and member ID in the same month of service on another claim is reused. Sends a real-time 270 when the agency's connection supports it and applies the 271 answer at once (an inactive coverage blocks billing that payer), giving the lines a biller has to look at, such as a Medicare answer that names a Medicare Advantage plan. Otherwise, or when the real-time request gets no answer, uploads a batch 270 whose 271 arrives with the payer files; a real-time answer that cannot be read is not asked again in batch, and a retried step returns what it already got instead of asking again.",
    level: 'basic',
    keywords: ['eligibility', '270', '271', 'insurance check', 'coverage'],
    effect: true,
    inputs: [
      claimIdPin,
      pin('force', 'boolean', {
        optional: true,
        label: 'Ask Again',
        description: 'Ask every payer, even one already answered or waiting for an answer.'
      })
    ],
    outputs: [
      pin('fileName', 'string', {
        label: 'File Name',
        description: 'The name of the real-time 271 answer.'
      }),
      pin(
        'reviews',
        { list: PAYER_FILE_LINE },
        {
          description: 'The answer lines a biller has to look at.'
        }
      ),
      sentAsPin,
      reasonPin
    ],
    exits: {
      answered: { label: 'Answered', description: 'The payers answered in real time.' },
      sent: { label: 'Sent', description: 'A batch request was sent; the answer comes later.' },
      unavailable: UNAVAILABLE
    },
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
      "Asks the payer through the clearinghouse where a submitted claim stands (276). Sends it in real time when the agency's connection supports it and logs the 277 answer on the claim; otherwise, or when the real-time request gets no answer, uploads a batch 276 whose 277 is logged when it arrives, and gives how many claim changes were seen so a wait can start from there. A real-time answer that does not name the claim is not asked again in batch, and a retried step returns what it already sent instead of asking again.",
    level: 'basic',
    keywords: ['claim status', '276', '277', 'follow up'],
    effect: true,
    inputs: [
      claimIdPin,
      pin(
        'coverageId',
        { id: 'coverage' },
        {
          label: 'Payer',
          description: 'The payer on the claim to ask.'
        }
      )
    ],
    outputs: [
      pin('status', 'string', { description: 'What the payer said about the claim.' }),
      sentAsPin,
      pin('signalsSeen', 'integer', {
        label: 'Signals Seen',
        description: 'How many claim changes were seen when the request was sent.'
      }),
      reasonPin
    ],
    exits: {
      answered: { label: 'Answered', description: 'The payer answered in real time.' },
      sent: { label: 'Sent', description: 'A batch request was sent; the answer comes later.' },
      unavailable: UNAVAILABLE
    },
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
      'Gives the latest claim status the payer being billed gave (277) since the claim was last sent or followed up, or nothing.',
    level: 'basic',
    keywords: ['claim status', '277'],
    inputs: [claimIdPin],
    outputs: [
      pin('status', 'string', { description: 'The latest status the payer gave, if any.' })
    ],
    compute: async (inputs, _, ctx) => {
      const claimId = claimIdOf(inputs.claimId);
      const ledger = await stores().claims.ledger(ctx.runId, claimId);
      if (!ledger) throw new Error(`Claim ${claimId} does not exist`);
      return { status: claimProgress(ledger).claimStatus };
    }
  })
];
