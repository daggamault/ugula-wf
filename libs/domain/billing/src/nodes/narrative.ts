import { actionNode, pin } from '@ugula/graph';
import { FINDINGS } from '../claim-models.ts';
import { readNarrative } from '../narrative.ts';
import { textOrNull } from '../values.ts';
import type { NodesOf } from './stores.ts';

export const narrativeNodes: NodesOf = (stores) => [
  actionNode({
    type: 'billing.read-narrative',
    title: 'Read Narrative',
    category: 'Billing',
    description:
      'Uses the local language model to list the medication doses (with routes) and CMS ALS2 procedures the crew documented in the PCR narrative, noting when only the start of a long narrative was read. Suggestions only; a biller confirms the level of service.',
    level: 'basic',
    keywords: ['ai', 'medications', 'procedures', 'als2'],
    inputs: [
      pin('narrative', 'string', {
        optional: true,
        description: 'The narrative the crew wrote in the patient care report.'
      })
    ],
    outputs: [
      pin('findings', FINDINGS.type, {
        label: 'Narrative Findings',
        description: 'The medications and procedures the narrative documents, as suggestions.'
      })
    ],
    compute: async (inputs, _, ctx) => ({
      findings: await readNarrative(
        stores().completer,
        textOrNull(inputs.narrative) ?? '',
        ctx.signal
      )
    })
  })
];
