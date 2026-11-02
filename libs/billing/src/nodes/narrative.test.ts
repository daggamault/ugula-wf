import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { invokeNode } from '@ugula/graph/testing';
import { billingStores, scriptedCompleter } from '../testing.ts';
import { narrativeNodes } from './narrative.ts';

describe('narrativeNodes', () => {
  it('reads narrative findings with the language model, skipping empty narratives', async () => {
    const model = scriptedCompleter(() => ({
      medications: [{ medication: 'fentanyl', route: 'IV', doses: 2 }],
      procedures: ['intraosseous line']
    }));
    const stores = billingStores({ completer: model.completer });
    const [read] = narrativeNodes(() => stores);
    if (!read) throw new Error('No read-narrative node');
    const found = await invokeNode(read, { inputs: { narrative: 'Fentanyl 50 IV x2, IO tibia' } });
    assert.deepEqual(found.outputs, {
      findings: {
        medications: [{ medication: 'fentanyl', route: 'IV', doses: 2 }],
        procedures: ['intraosseous line'],
        ivDoses: 2
      }
    });
    assert.deepEqual((await invokeNode(read)).outputs.findings, {
      medications: [],
      procedures: [],
      ivDoses: 0
    });
    assert.equal(model.asked.length, 1);
  });
});
