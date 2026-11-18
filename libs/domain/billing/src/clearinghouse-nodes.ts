import { actionNode, branchNode, type NodeDef, pin } from '@ugula/graph';
import { CLAIM_SETTLEMENTS, type ClaimSettlement } from './claims.ts';
import type { BillingStores } from './stores.ts';

const FILE_ID = { id: 'clearinghouseFile' } as const;

const CLAIM_ID = { id: 'claim' } as const;

const PAYMENT_ID = { id: 'payment' } as const;

const REMITTANCE_ID = { id: 'remittance' } as const;

const count = <N extends string>(name: N, description: string) =>
  pin(name, 'integer', { description });

const found = (noun: string) => ({
  found: { label: 'Found', description: `The ${noun} exists; its fields are on the outputs.` },
  notFound: {
    label: 'Not Found',
    description: `No ${noun} has this ID in the agency, so the outputs are empty.`
  }
});

export const createClearinghouseNodes = (storesOf: () => BillingStores): NodeDef[] => [
  actionNode({
    type: 'clearinghouse-file.acknowledge',
    title: 'Apply Acknowledgments',
    category: 'Clearinghouse',
    description:
      'Applies a TA1, 999 or 277CA from the clearinghouse to the claims it answers: an accepted claim is with its payer, with the payer claim number when the 277CA gives one; a rejected file or claim marks the payer it was sent to Rejected, with why, which emits Claim Rejected.',
    level: 'basic',
    keywords: ['999', 'ta1', '277ca', 'acknowledgment', 'reject', 'accept', 'clearinghouse'],
    effect: true,
    inputs: [pin('fileId', FILE_ID, { label: 'File', description: 'The file to apply.' })],
    outputs: [
      count('accepted', 'How many claims or files it accepted.'),
      count('rejected', 'How many claims or files it rejected.')
    ],
    compute: async ({ fileId }, _, ctx) =>
      storesOf().clearinghouse.applyAcknowledgments(ctx.runId, fileId)
  }),
  actionNode({
    type: 'clearinghouse-file.post-remittance',
    title: 'Post Remittance',
    category: 'Clearinghouse',
    description:
      'Posts an 835 remittance: saves each payment, and for each claim it pays, denies, forwards or takes back, records what the payer did on the payer that has the claim, which emits Payment Posted. A payment for a claim it cannot match is kept for a person to reconcile.',
    level: 'basic',
    keywords: ['835', 'era', 'remittance', 'payment', 'posting', 'denial'],
    effect: true,
    inputs: [pin('fileId', FILE_ID, { label: 'File', description: 'The 835 to post.' })],
    outputs: [
      count('remittances', 'How many payments (checks or EFTs) the file held.'),
      count('posted', 'How many claim payments were posted to their claims.'),
      count('unmatched', 'How many claim payments matched no claim with a payer waiting.')
    ],
    compute: async ({ fileId }, _, ctx) =>
      storesOf().clearinghouse.postRemittance(ctx.runId, fileId)
  }),
  branchNode({
    type: 'payment.read',
    title: 'Read Payment',
    category: 'Clearinghouse',
    description:
      'Reads a posted payment: what the payer did with the claim, what it paid, what it leaves the patient, whether another payer comes after it, and its reason codes.',
    level: 'basic',
    keywords: ['payment', 'remittance', 'paid', 'denied', 'patient responsibility'],
    inputs: [
      pin('paymentId', PAYMENT_ID, { label: 'Payment', description: 'The payment to read.' })
    ],
    outputs: [
      pin('claimId', CLAIM_ID, { label: 'Claim', description: 'The claim it pays.' }),
      pin('claimNumber', 'string', { description: 'The number of the claim it pays.' }),
      pin('outcome', { code: 'paymentOutcome' }, { description: 'What the payer did.' }),
      pin('paidCents', 'integer', { label: 'Paid', description: 'What it paid, in cents.' }),
      pin('patientCents', 'integer', {
        label: 'Patient Responsibility',
        description: 'What it left the patient (group PR), in cents.'
      }),
      pin('hasNextPayer', 'boolean', {
        label: 'Has Next Payer',
        description: 'Whether another payer on the claim comes after this one.'
      }),
      pin(
        'reasons',
        { list: 'string' },
        { description: 'Its adjustment reasons and remarks, each with what it means.' }
      )
    ],
    exits: found('payment'),
    compute: async ({ paymentId }, _, ctx) => {
      const p = await storesOf().clearinghouse.findPayment(ctx.runId, paymentId);
      return p ? { exit: 'found', outputs: p } : { exit: 'notFound', outputs: {} };
    }
  }),
  branchNode({
    type: 'claim.settle',
    title: 'Settle Claim',
    category: 'Claim',
    description:
      'Settles a claim its payers are done with: Closed when nothing is owed or the rest is written off, Patient Balance when the patient owes the rest, or Denied while a denial is appealed. A claim edited or sent again since is left alone.',
    level: 'basic',
    keywords: ['close', 'write off', 'patient balance', 'denied', 'settle'],
    effect: true,
    inputs: [
      pin('claimId', CLAIM_ID, { label: 'Claim', description: 'The claim to settle.' }),
      pin(
        'settlement',
        { code: 'claimSettlement' },
        { description: 'Closed, Patient Balance or Denied.' }
      ),
      pin('note', 'string', { optional: true, description: 'Why, such as a write-off reason.' })
    ],
    outputs: [],
    exits: {
      settled: { label: 'Settled', description: 'The claim has its new status.' },
      changed: {
        label: 'Changed',
        description: 'The claim was edited or sent again since, so it was left alone.'
      }
    },
    compute: async ({ claimId, settlement, note }, _, ctx) => {
      if (!CLAIM_SETTLEMENTS.includes(settlement as ClaimSettlement)) {
        throw new Error(`${settlement} is not a claim settlement`);
      }
      return {
        exit: await storesOf().claims.settleClaim(
          ctx.runId,
          claimId,
          settlement as ClaimSettlement,
          note?.trim() || null
        ),
        outputs: {}
      };
    }
  }),
  branchNode({
    type: 'remittance.read',
    title: 'Read Remittance',
    category: 'Clearinghouse',
    description:
      'Reads a posted remittance: the payer, the amount, whether its claim payments and provider adjustments add up to it, and how many payments matched no claim.',
    level: 'basic',
    keywords: ['remittance', '835', 'reconcile', 'balance', 'eft', 'check'],
    inputs: [
      pin('remittanceId', REMITTANCE_ID, {
        label: 'Remittance',
        description: 'The remittance to read.'
      })
    ],
    outputs: [
      pin('payerName', 'string', { optional: true, description: 'The payer that sent it.' }),
      pin('totalCents', 'integer', { label: 'Total', description: 'The payment, in cents.' }),
      pin('balanced', 'boolean', {
        description: 'Whether its claim payments less provider adjustments make the payment.'
      }),
      count('unmatched', 'How many of its claim payments matched no claim.'),
      pin('reconciled', 'boolean', { description: 'Whether it was reconciled already.' })
    ],
    exits: found('remittance'),
    compute: async ({ remittanceId }, _, ctx) => {
      const r = await storesOf().clearinghouse.findRemittance(ctx.runId, remittanceId);
      return r ? { exit: 'found', outputs: r } : { exit: 'notFound', outputs: {} };
    }
  }),
  actionNode({
    type: 'remittance.reconcile',
    title: 'Reconcile Remittance',
    category: 'Clearinghouse',
    description:
      'Marks a remittance reconciled: by the biller who checked it, with a note, or by the workflow when it balanced and every payment matched a claim.',
    level: 'basic',
    keywords: ['remittance', 'reconcile', 'balance', 'close'],
    effect: true,
    inputs: [
      pin('remittanceId', REMITTANCE_ID, {
        label: 'Remittance',
        description: 'The remittance reconciled.'
      }),
      pin('reconciledBy', 'string', {
        optional: true,
        label: 'Reconciled By',
        description: 'The biller who reconciled it; empty when it reconciled itself.'
      }),
      pin('note', 'string', { optional: true, description: 'What the biller found or did.' })
    ],
    outputs: [],
    compute: async ({ remittanceId, reconciledBy, note }, _, ctx) => {
      await storesOf().clearinghouse.reconcileRemittance(
        ctx.runId,
        remittanceId,
        reconciledBy?.trim() || null,
        note?.trim() || null
      );
      return {};
    }
  })
];
