import { branchNode, pin } from '@ugula/graph';
import { isDocumentKind } from '../claim-documents.ts';
import { paymentLine, readPayment } from '../claim-payments.ts';
import { readPayerNames } from '../claim-tasks.ts';
import { REMITTANCE_LINE, REMITTANCE_POSTING } from '../ledger-models.ts';
import { BLOB } from '../model-kit.ts';
import { readPostings } from '../remittances.ts';
import { requiredText, textOrNull } from '../values.ts';
import { claimIdOf, claimIdPin } from './claims.ts';
import type { NodesOf, Refused } from './stores.ts';

const CATEGORY = 'Billing';

const reasonPin = pin('reason', 'string', {
  label: 'Why Not',
  description: 'Why it was refused, in words a biller reads.'
});

const REFUSED = { label: 'Refused', description: 'Nothing was done; Why Not says why.' };

const refused = (reason: string): Refused => ({ status: 'refused', reason });

const PAYMENT_PINS = [
  pin('kind', 'string', {
    optional: true,
    label: 'Payment or Refund',
    description: 'Whether money came in (a payment) or was paid back (a refund).'
  }),
  pin(
    'coverageId',
    { id: 'coverage' },
    {
      optional: true,
      label: 'Payer',
      description: 'The payer on the claim that paid, or none for the patient.'
    }
  ),
  pin('paid', 'number', {
    optional: true,
    label: 'Paid (Dollars)',
    description: 'The amount paid, in dollars.'
  }),
  pin('paidOn', 'string', {
    optional: true,
    label: 'Paid On',
    description: 'The date of the payment (YYYY-MM-DD).'
  }),
  pin('checkNumber', 'string', {
    optional: true,
    label: 'Check Number',
    description: 'The check or payment reference number.'
  }),
  pin('payerClaimNumber', 'string', {
    optional: true,
    label: 'Payer Claim Number',
    description: 'The number the payer gave the claim.'
  }),
  pin(
    'reasonCodes',
    { list: 'string' },
    {
      optional: true,
      label: 'Reason Codes',
      description: 'Adjustment reason codes with amounts, like CO-45 12.50, one per line.'
    }
  ),
  pin('note', 'string', { optional: true, description: 'A note the biller added.' })
];

export const claimTaskNodes: NodesOf = (stores) => {
  const tasks = () => stores().claimTasks;
  return [
    branchNode({
      type: 'billing.payment-line',
      title: 'Payment Line',
      category: CATEGORY,
      description:
        'Reads a payment a biller entered by hand as one remittance line, with its reason codes (like CO-45 12.50, one per line) as adjustments, so Route Remittance classifies and routes it like an 835 claim payment. Amounts are in dollars. Decides nothing.',
      level: 'basic',
      keywords: ['payment', 'manual payment', 'remittance'],
      inputs: [claimIdPin, ...PAYMENT_PINS],
      outputs: [
        pin('line', REMITTANCE_LINE.type, {
          label: 'Remittance Line',
          description: 'The payment as one remittance line, ready to route.'
        }),
        reasonPin
      ],
      exits: {
        read: { label: 'Read', description: 'The payment was read as a remittance line.' },
        refused: {
          label: 'Refused',
          description: 'The amounts or reason codes could not be read; Why Not says why.'
        }
      },
      compute: (inputs) => {
        const payment = readPayment(inputs);
        return typeof payment === 'string'
          ? { exit: 'refused', outputs: { line: null, reason: payment } }
          : {
              exit: 'read',
              outputs: { line: paymentLine(claimIdOf(inputs.claimId), payment), reason: null }
            };
      }
    }),
    branchNode({
      type: 'billing.set-claim-payers',
      title: 'Set Claim Payers',
      category: CATEGORY,
      description:
        'Sets the payers a claim is billed to, by name in billing order: keeps the payers still named (with their member IDs and history) in the new order, adds new names (linked to the payer directory by name or a name it learned) and removes the rest, then lets the claim cycle know. Refused when the claim is a draft or closed, a name is listed twice, or a payer to remove already has billing activity.',
      level: 'basic',
      keywords: ['payers', 'insurance', 'coverage', 'billing order'],
      effect: true,
      inputs: [
        claimIdPin,
        pin(
          'payers',
          { list: 'string' },
          {
            label: 'Payer Names',
            description: 'The payer names, in the order to bill them.'
          }
        )
      ],
      outputs: [reasonPin],
      exits: {
        saved: { label: 'Saved', description: 'The claim payers were saved.' },
        refused: REFUSED
      },
      compute: async (inputs, _, ctx) => {
        const claimId = claimIdOf(inputs.claimId);
        const names = readPayerNames(inputs.payers);
        const saved =
          typeof names === 'string'
            ? refused(names)
            : await tasks().setPayers(ctx.runId, claimId, names);
        return saved.status === 'refused'
          ? { exit: 'refused', outputs: { reason: saved.reason } }
          : { exit: 'saved', outputs: { reason: null } };
      }
    }),
    branchNode({
      type: 'billing.post-claim-payment',
      title: 'Post Claim Payment',
      category: CATEGORY,
      description:
        "Posts a payment a biller entered by hand, once per step, the way Route Remittance routed it: a payer's payment with what its reason codes take off the balance, logging a denial to work for a denial route, a patient's payment, or a refund paid back. Amounts are in dollars. It settles tasks the payment makes moot and lets the claim cycle know, like a remittance. Refused when the claim is a draft or closed, the payer is not on the claim, the routing leaves it to be posted another way or the amounts do not add up.",
      level: 'basic',
      keywords: ['payment', 'post', 'refund', 'manual payment'],
      effect: true,
      inputs: [
        claimIdPin,
        ...PAYMENT_PINS,
        pin('posting', REMITTANCE_POSTING.type, {
          optional: true,
          label: 'Posting',
          description: 'How Route Remittance routed the payment.'
        }),
        pin('postedBy', 'string', {
          optional: true,
          label: 'Posted By',
          description: 'The biller who posted the payment.'
        })
      ],
      outputs: [
        pin('balanceCents', 'integer', {
          label: 'Balance (Cents)',
          description: 'The claim balance after the payment, in cents.'
        }),
        reasonPin
      ],
      exits: {
        posted: { label: 'Posted', description: 'The payment was posted to the claim.' },
        refused: REFUSED
      },
      compute: async (inputs, _, ctx) => {
        const claimId = claimIdOf(inputs.claimId);
        const posting =
          inputs.posting === null ? null : (readPostings([inputs.posting])[0] ?? null);
        const payment =
          inputs.posting !== null && posting === null
            ? 'Route Remittance did not route this payment; route it again'
            : readPayment(inputs, posting);
        const posted =
          typeof payment === 'string'
            ? refused(payment)
            : await tasks().postPayment(
                ctx.runId,
                claimId,
                ctx.key,
                payment,
                textOrNull(inputs.postedBy)
              );
        return posted.status === 'refused'
          ? { exit: 'refused', outputs: { balanceCents: null, reason: posted.reason } }
          : { exit: 'posted', outputs: { balanceCents: posted.balanceCents, reason: null } };
      }
    }),
    branchNode({
      type: 'billing.add-claim-document',
      title: 'Add Claim Document',
      category: CATEGORY,
      description:
        "Keeps a file uploaded in a task with the claim as a document of its kind (facesheet, pcs, signature, abn or msp), with the date it was signed, and logs it, once per step. The file must be a PDF, PNG, JPEG or TIFF, told by its content, and one of this agency's uploads. Gives the document for Receive Document to read. Refused when the claim is closed or the file is not a document.",
      level: 'basic',
      keywords: ['upload', 'attachment', 'document', 'pcs', 'abn'],
      effect: true,
      inputs: [
        claimIdPin,
        pin('kind', 'string', {
          label: 'Document Kind',
          description: 'What the document is: facesheet, pcs, signature, abn or msp.'
        }),
        pin('signedOn', 'string', {
          optional: true,
          label: 'Signed On',
          description: 'The date the document was signed (YYYY-MM-DD).'
        }),
        pin('file', BLOB, { description: 'The uploaded file.' }),
        pin('addedBy', 'string', {
          optional: true,
          label: 'Added By',
          description: 'The biller who added the document.'
        })
      ],
      outputs: [
        pin(
          'documentId',
          { id: 'document' },
          {
            label: 'Document',
            description: 'The document added to the claim.'
          }
        ),
        reasonPin
      ],
      exits: {
        added: { label: 'Added', description: 'The document is on the claim.' },
        refused: REFUSED
      },
      compute: async (inputs, _, ctx) => {
        const claimId = claimIdOf(inputs.claimId);
        const added = isDocumentKind(inputs.kind)
          ? await tasks().addDocument(ctx.runId, claimId, ctx.key, {
              kind: inputs.kind,
              signedOn: textOrNull(inputs.signedOn),
              file: {
                bucket: requiredText(inputs.file.bucket, 'The upload has no bucket'),
                key: requiredText(inputs.file.key, 'The upload has no key')
              },
              addedBy: textOrNull(inputs.addedBy)
            })
          : refused('Choose what kind of document it is');
        return added.status === 'refused'
          ? { exit: 'refused', outputs: { documentId: null, reason: added.reason } }
          : { exit: 'added', outputs: { documentId: added.documentId, reason: null } };
      }
    })
  ];
};
