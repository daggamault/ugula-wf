import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { invokeNode } from '@ugula/graph/testing';
import { billingStores, scriptedCompleter } from '../testing.ts';
import { narrativeNodes } from './narrative.ts';

const NO_FINDINGS = { medications: [], procedures: [], ivDoses: 0, notes: [] };

const readNode = () => {
  const model = scriptedCompleter(() => ({
    medications: [{ medication: 'fentanyl', route: 'IV', doses: 2, evidence: 'Fentanyl 50 IV x2' }],
    procedures: [{ procedure: 'intraosseous line', evidence: 'IO tibia' }]
  }));
  const stores = billingStores({ completer: model.completer });
  const [read] = narrativeNodes(() => stores);
  if (!read) throw new Error('No read-narrative node');
  return { read, asked: model.asked };
};

describe('narrativeNodes', () => {
  it('reads narrative findings with the language model, sending it the trimmed narrative', async () => {
    const { read, asked } = readNode();
    const found = await invokeNode(read, {
      inputs: { narrative: '  Fentanyl 50 IV x2, IO tibia  ' }
    });
    assert.deepEqual(found.outputs, {
      findings: {
        medications: [{ medication: 'fentanyl', route: 'IV', doses: 2 }],
        procedures: ['intraosseous line'],
        ivDoses: 2,
        notes: []
      }
    });
    assert.deepEqual(
      asked.map((r) => r.user),
      ['Fentanyl 50 IV x2, IO tibia']
    );
  });

  it('finds nothing without asking the model when there is no narrative', async () => {
    const { read, asked } = readNode();
    assert.deepEqual((await invokeNode(read)).outputs, { findings: NO_FINDINGS });
    assert.equal(asked.length, 0);
  });

  it('finds nothing without asking the model when the narrative is blank', async () => {
    const { read, asked } = readNode();
    assert.deepEqual((await invokeNode(read, { inputs: { narrative: '  \n ' } })).outputs, {
      findings: NO_FINDINGS
    });
    assert.equal(asked.length, 0);
  });
});
