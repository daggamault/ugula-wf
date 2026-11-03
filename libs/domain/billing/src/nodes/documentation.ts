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
    inputs: [pin('signatures', { list: { object: {} } }, { optional: true })],
    outputs: [pin('signature', 'string'), pin('signatureNote', 'string')],
    compute: ({ signatures }) => signatureOf(signatures)
  })
];
