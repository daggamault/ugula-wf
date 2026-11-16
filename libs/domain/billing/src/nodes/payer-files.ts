import { branchNode, pin } from '@ugula/graph';
import { BLOB } from '../model-kit.ts';
import { billingTypes } from '../models.ts';
import { readPostings } from '../remittances.ts';
import { requiredText } from '../values.ts';
import type { NodesOf } from './stores.ts';

const CATEGORY = 'Billing';

export const PAYER_FILE_LINE = {
  object: { reference: 'string', claimId: { id: 'claim' }, outcome: 'string', message: 'string' }
} as const;

const filePin = pin('file', BLOB, { description: 'The stored payer file.' });

const fileNamePin = pin('fileName', 'string', {
  label: 'File Name',
  description: 'The name the file arrived with.'
});

const fileIdPin = pin(
  'fileId',
  { id: 'payerFile' },
  {
    label: 'Payer File',
    description: 'The payer file record, when the file was applied.'
  }
);

const DUPLICATE = { label: 'Duplicate', description: 'The same file was already applied.' };

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
      'Reads a clearinghouse file without applying it: what kind it is (835, TA1, 999, 277CA, 277 claim status or 271) and, for an 835, each claim payment with the claim and payer it matched, so the remittance rules can route it.',
    level: 'basic',
    keywords: ['835', 'era', 'remittance', '999', '277', 'clearinghouse file'],
    inputs: [filePin, fileNamePin],
    outputs: [
      pin('kind', 'string', {
        description: 'What kind of file it is (835, TA1, 999, 277CA, 277 or 271).'
      }),
      pin('lines', billingTypes.remittanceLines, {
        label: 'Remittance Lines',
        description: 'Each claim payment of an 835, with the claim and payer it matched.'
      }),
      fileIdPin,
      pin('reason', 'string', { description: 'Why the file could not be read.' })
    ],
    exits: {
      read: { label: 'Read', description: 'The file was read.' },
      duplicate: DUPLICATE,
      unreadable: {
        label: 'Unreadable',
        description: 'It is not a file the app reads; the reason says why.'
      }
    },
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
      'Applies a clearinghouse file to its claims, once: an 835 posts each claim payment the way the remittance rules routed it (postings), a 999 accepts or rejects every claim in its 837P file, a 277CA accepts or rejects single claims (a rejection of the billing provider or receiver rejects every claim under it, keeping the REF*1K of a rejected claim off it), a 271 records whether coverage is active, a TA1 rejection marks its 837P file rejected at the envelope and sends its claims back to review (giving why, for whoever sets up the clearinghouse) and a 277 claim status is logged on each claim. Gives the lines a biller has to look at.',
    level: 'basic',
    keywords: ['835', 'era', 'post payments', '999', '277', 'clearinghouse file'],
    effect: true,
    inputs: [
      filePin,
      fileNamePin,
      pin('postings', billingTypes.postings, {
        optional: true,
        label: 'Remittance Postings',
        description: 'How the remittance rules routed each claim payment of an 835.'
      })
    ],
    outputs: [
      fileIdPin,
      pin('kind', 'string', {
        description: 'What kind of file it is (835, TA1, 999, 277CA, 277 or 271).'
      }),
      pin(
        'reviews',
        { list: PAYER_FILE_LINE },
        {
          description: 'The lines a biller has to look at.'
        }
      ),
      pin('envelopeRejection', 'string', {
        label: 'Envelope Rejection',
        description: 'Why a TA1 rejected the whole file, for whoever sets up the clearinghouse.'
      })
    ],
    exits: {
      applied: { label: 'Applied', description: 'The file was applied to its claims.' },
      duplicate: DUPLICATE
    },
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
