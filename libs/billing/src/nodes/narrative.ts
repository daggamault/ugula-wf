import { actionNode, pin } from '@ugula/graph';
import { FINDINGS } from '../models.ts';
import { readNarrative } from '../narrative.ts';
import { textOrNull } from '../values.ts';
import type { NodesOf } from './stores.ts';

export const narrativeNodes: NodesOf = (stores) => [
  actionNode({
    type: 'billing.read-narrative',
    title: 'Read Narrative',
    category: 'Billing',
    description:
      'Uses the local language model to list the medication doses (with routes) and CMS ALS2 procedures the crew documented in the PCR narrative. Suggestions only; a biller confirms the level of service.',
    inputs: [pin('narrative', 'string', { optional: true })],
    outputs: [pin('findings', FINDINGS.type)],
    compute: async (inputs) => ({
      findings: await readNarrative(stores().completer, textOrNull(inputs.narrative) ?? '')
    })
  })
];
