import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { invokeNode } from '@ugula/graph/testing';
import { createBillingNodes } from './index.ts';

describe('createBillingNodes', () => {
  it('describes signatures without storage for validation in other apps', async () => {
    const nodes = createBillingNodes(null);
    assert.deepEqual(
      nodes.map((n) => `${n.type}@${n.version}`),
      [
        'billing.match-patient@1',
        'billing.create-patient@1',
        'billing.find-patient@1',
        'billing.update-patient-address@1',
        'billing.price-claim@1',
        'billing.set-fee@1',
        'billing.validate-claim@1',
        'billing.patch-claim@1',
        'billing.open-claim@1',
        'billing.assign-patient@1',
        'billing.save-claim@1',
        'billing.note-revision@1',
        'billing.match-payers@1',
        'billing.link-payer@1',
        'billing.read-narrative@1',
        'billing.attach-cycle@1',
        'billing.claim-step@1',
        'billing.record-claim-event@1',
        'billing.issue-statement@1',
        'billing.close-claim@1'
      ]
    );
    const [match] = nodes;
    if (!match) throw new Error('No match-patient node');
    await assert.rejects(
      () => invokeNode(match, { inputs: { demographics: { lastName: 'Doe' } } }),
      /only the worker provides/
    );
    const setFee = nodes.find((n) => n.type === 'billing.set-fee') ?? match;
    const { signature, outputs } = await invokeNode(setFee, {
      inputs: { code: 'A0999', unitPrice: 10 }
    });
    assert.deepEqual([signature.execOut, outputs.fees], [['then'], { A0999: 1000 }]);
  });
});
