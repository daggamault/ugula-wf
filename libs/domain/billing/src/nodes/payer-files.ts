import { branchNode, pin } from '@ugula/graph';
import { BLOB } from '../models.ts';
import { requiredText } from '../values.ts';
import type { NodesOf } from './stores.ts';

const CATEGORY = 'Billing';

const PAYER_FILE_LINE = {
  object: { reference: 'string', claimId: 'string', outcome: 'string', message: 'string' }
} as const;

const blobOf = ({ bucket, key }: { bucket: string | null; key: string | null }) => {
  if (!bucket || !key) throw new Error('No payer file to apply');
  return { bucket, key };
};

export const payerFileNodes: NodesOf = (stores) => [
  branchNode({
    type: 'billing.apply-payer-file',
    title: 'Apply Payer File',
    category: CATEGORY,
    description:
      'Applies a clearinghouse file to its claims: an 835 posts payments and adjustments, a 999 accepts or rejects every claim in its 837P file, a 277CA accepts or rejects single claims and a 271 records whether coverage is active. Outputs the lines a biller has to look at (unknown claims, reversals, payers not on the claim). Continues through duplicate when the same file was applied before, and through unreadable when it is not one of those files.',
    effect: true,
    inputs: [pin('file', BLOB), pin('fileName', 'string')],
    outputs: [
      pin('fileId', 'string'),
      pin('kind', 'string'),
      pin('reviews', { list: PAYER_FILE_LINE }),
      pin('reason', 'string')
    ],
    exits: ['applied', 'duplicate', 'unreadable'],
    compute: async (inputs, _, ctx) => {
      const applied = await stores().payerFiles.apply(ctx.runId, ctx.key, {
        document: blobOf(inputs.file),
        fileName: requiredText(inputs.fileName, 'No payer file name')
      });
      const none = { fileId: null, kind: null, reviews: [], reason: null };
      switch (applied.status) {
        case 'applied':
          return {
            exit: 'applied',
            outputs: {
              ...none,
              fileId: applied.fileId,
              kind: applied.kind,
              reviews: applied.reviews
            }
          };
        case 'duplicate':
          return { exit: 'duplicate', outputs: { ...none, fileId: applied.fileId } };
        case 'unreadable':
          return { exit: 'unreadable', outputs: { ...none, reason: applied.reason } };
      }
    }
  })
];
