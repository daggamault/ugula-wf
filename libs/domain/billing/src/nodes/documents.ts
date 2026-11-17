import { actionNode, pin } from '@ugula/graph';
import { isDocumentKind } from '../claim-documents.ts';
import { claimIdOf, claimIdPin } from './claims.ts';
import type { NodesOf } from './stores.ts';

export const documentNodes: NodesOf = (stores) => [
  actionNode({
    type: 'billing.document-chases',
    title: 'Document Chases',
    category: 'Billing',
    description:
      'Reads the kinds of document open Chase Document runs on a claim are chasing, such as pcs or signature: the kind each was started with, or the one a biller chose for it. Decides nothing.',
    level: 'basic',
    keywords: ['document', 'chase', 'missing', 'open'],
    inputs: [claimIdPin],
    outputs: [
      pin(
        'chasing',
        { list: 'string' },
        { label: 'Chasing', description: 'The kinds of document being chased, each once.' }
      )
    ],
    compute: async ({ claimId }, _, ctx) => {
      const kinds = await stores().documents.chasedDocuments(ctx.runId, claimIdOf(claimId));
      return { chasing: [...new Set(kinds.filter(isDocumentKind))].sort() };
    }
  })
];
