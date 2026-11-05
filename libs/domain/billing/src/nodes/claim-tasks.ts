import { branchNode, pin } from '@ugula/graph';
import { isDocumentKind } from '../claim-documents.ts';
import { readPayment } from '../claim-payments.ts';
import { readPayerNames } from '../claim-tasks.ts';
import { BLOB } from '../model-kit.ts';
import { requiredText, textOrNull } from '../values.ts';
import { claimIdOf, claimIdPin } from './claims.ts';
import type { NodesOf, Refused } from './stores.ts';

const CATEGORY = 'Billing';

const reasonPin = pin('reason', 'string', { label: 'Why Not' });

const refused = (reason: string): Refused => ({ status: 'refused', reason });

export const claimTaskNodes: NodesOf = (stores) => {
  const tasks = () => stores().claimTasks;
  return [
    branchNode({
      type: 'billing.set-claim-payers',
      title: 'Set Claim Payers',
      category: CATEGORY,
      description:
        'Sets the payers a claim is billed to, by name in billing order: keeps the payers still named (with their member IDs and history) in the new order, adds new names (linked to the payer directory by name or a name it learned) and removes the rest, then signals the claim. Continues through refused, saying why, when the claim is a draft or closed, a name is listed twice, or a payer to remove already has billing activity.',
      effect: true,
      inputs: [claimIdPin, pin('payers', { list: 'string' }, { label: 'Payer Names' })],
      outputs: [reasonPin],
      exits: ['saved', 'refused'],
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
        "Posts a payment a biller entered by hand, once per run step: a payer's or the patient's payment with its adjustment and reason codes (like CO-45 12.50, one per line), or a refund paid back. Amounts are in dollars. It settles tasks the payment makes moot and signals the claim, like a remittance. Continues through refused, saying why, when the claim is a draft or closed, the payer is not on the claim or the amounts do not add up.",
      effect: true,
      inputs: [
        claimIdPin,
        pin('kind', 'string', { optional: true, label: 'Payment or Refund' }),
        pin('coverageId', 'string', { optional: true, label: 'Payer' }),
        pin('paid', 'number', { optional: true, label: 'Paid (Dollars)' }),
        pin('adjusted', 'number', { optional: true, label: 'Adjusted (Dollars)' }),
        pin('paidOn', 'string', { optional: true }),
        pin('checkNumber', 'string', { optional: true }),
        pin('payerClaimNumber', 'string', { optional: true }),
        pin('reasonCodes', { list: 'string' }, { optional: true }),
        pin('note', 'string', { optional: true }),
        pin('postedBy', 'string', { optional: true })
      ],
      outputs: [pin('balanceCents', 'integer'), reasonPin],
      exits: ['posted', 'refused'],
      compute: async (inputs, _, ctx) => {
        const claimId = claimIdOf(inputs.claimId);
        const payment = readPayment(inputs);
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
        "Keeps a file uploaded in a task with the claim as a document of its kind (facesheet, pcs, signature, abn or msp), with the date it was signed, and logs it, once per run step. The file must be a PDF, PNG, JPEG or TIFF, told by its content, and one of this agency's uploads. Outputs the document for Receive Document to read. Continues through refused, saying why, when the claim is closed or the file is not a document.",
      effect: true,
      inputs: [
        claimIdPin,
        pin('kind', 'string', { label: 'Document Kind' }),
        pin('signedOn', 'string', { optional: true }),
        pin('file', BLOB),
        pin('addedBy', 'string', { optional: true })
      ],
      outputs: [pin('documentId', 'string'), reasonPin],
      exits: ['added', 'refused'],
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
