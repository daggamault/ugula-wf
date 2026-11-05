import { branchNode, pin } from '@ugula/graph';
import { BLOB, billingTypes } from '../models.ts';
import { readPostings } from '../remittances.ts';
import { requiredText } from '../values.ts';
import type { NodesOf } from './stores.ts';

const CATEGORY = 'Billing';

export const PAYER_FILE_LINE = {
  object: { reference: 'string', claimId: 'string', outcome: 'string', message: 'string' }
} as const;

const blobOf = ({ bucket, key }: { bucket: string | null; key: string | null }) => {
  if (!bucket || !key) throw new Error('No payer file to apply');
  return { bucket, key };
};

const fileOf = (inputs: {
  file: { bucket: string | null; key: string | null };
  fileName: string;
}) => ({
  document: blobOf(inputs.file),
  fileName: requiredText(inputs.fileName, 'No payer file name')
});

export const payerFileNodes: NodesOf = (stores) => [
  branchNode({
    type: 'billing.read-payer-file',
    title: 'Read Payer File',
    category: CATEGORY,
    description:
      'Reads a clearinghouse file without applying it: what kind it is (835, TA1, 999, 277CA, 277 claim status or 271) and, for an 835, each claim payment with the claim and payer it matched, so the remittance rules can route it. Continues through duplicate when the same file was applied before, and through unreadable when it is not one of those files.',
    inputs: [pin('file', BLOB), pin('fileName', 'string')],
    outputs: [
      pin('kind', 'string'),
      pin('lines', billingTypes.remittanceLines, { label: 'Remittance Lines' }),
      pin('fileId', 'string'),
      pin('reason', 'string')
    ],
    exits: ['read', 'duplicate', 'unreadable'],
    compute: async (inputs, _, ctx) => {
      const read = await stores().payerFiles.read(ctx.runId, fileOf(inputs));
      const none = { kind: null, lines: [], fileId: null, reason: null };
      switch (read.status) {
        case 'read':
          return { exit: 'read', outputs: { ...none, kind: read.kind, lines: read.lines } };
        case 'duplicate':
          return { exit: 'duplicate', outputs: { ...none, fileId: read.fileId } };
        case 'unreadable':
          return { exit: 'unreadable', outputs: { ...none, reason: read.reason } };
      }
    }
  }),
  branchNode({
    type: 'billing.apply-payer-file',
    title: 'Apply Payer File',
    category: CATEGORY,
    description:
      'Applies a clearinghouse file to its claims, once: an 835 posts each claim payment the way the remittance rules routed it (postings), a 999 accepts or rejects every claim in its 837P file, a 277CA accepts or rejects single claims, a 271 records whether coverage is active, a TA1 rejection marks its 837P file rejected at the envelope and sends its claims back to review (outputting why, for whoever sets up the clearinghouse) and a 277 claim status is logged on each claim. Outputs the lines a biller has to look at. Continues through duplicate when the same file was applied meanwhile.',
    effect: true,
    inputs: [
      pin('file', BLOB),
      pin('fileName', 'string'),
      pin('postings', billingTypes.postings, { optional: true, label: 'Remittance Postings' })
    ],
    outputs: [
      pin('fileId', 'string'),
      pin('kind', 'string'),
      pin('reviews', { list: PAYER_FILE_LINE }),
      pin('envelopeRejection', 'string')
    ],
    exits: ['applied', 'duplicate'],
    compute: async (inputs, _, ctx) => {
      const applied = await stores().payerFiles.apply(ctx.runId, ctx.key, {
        ...fileOf(inputs),
        postings: readPostings(inputs.postings)
      });
      const none = { fileId: null, kind: null, reviews: [], envelopeRejection: null };
      switch (applied.status) {
        case 'applied':
          return {
            exit: 'applied',
            outputs: {
              fileId: applied.fileId,
              kind: applied.kind,
              reviews: applied.reviews,
              envelopeRejection: applied.envelopeRejection
            }
          };
        case 'duplicate':
          return { exit: 'duplicate', outputs: { ...none, fileId: applied.fileId } };
        case 'unreadable':
          throw new Error(applied.reason);
      }
    }
  })
];
