import { pin, pureNode } from '@ugula/graph';
import { signatureOf } from '../documentation.ts';
import type { NodesOf } from './stores.ts';

export const documentationNodes: NodesOf = () => [
  pureNode({
    type: 'billing.read-signature',
    title: 'Read Billing Signature',
    category: 'Billing',
    description:
      "Reads the report's release-for-billing signature: signed by the patient or a representative, an exception because the patient could not sign, refused, or missing, with why.",
    level: 'basic',
    keywords: ['signature', 'release', 'consent'],
    inputs: [
      pin(
        'signatures',
        { list: { object: {} } },
        {
          optional: true,
          description: 'The signatures recorded on the patient care report.'
        }
      )
    ],
    outputs: [
      pin('signature', 'string', {
        description: 'Whether the release was signed, an exception, refused or missing.'
      }),
      pin('signatureNote', 'string', {
        label: 'Signature Note',
        description: 'Why the patient did not sign, or who signed for them.'
      })
    ],
    compute: ({ signatures }) => signatureOf(signatures)
  })
];
