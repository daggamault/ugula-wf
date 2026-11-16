import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { nodeDocumentationIssues } from '@ugula/graph';
import { invokeNode } from '@ugula/graph/testing';
import { billingStores, memoryClaims } from '../testing.ts';
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
        'billing.find-fees@1',
        'billing.price-lines@1',
        'billing.set-fee@1',
        'billing.read-claim-checks@1',
        'billing.fix-claim-form@1',
        'billing.patch-claim@1',
        'billing.open-claim@1',
        'billing.assign-patient@1',
        'billing.save-claim@1',
        'billing.facility-choices@1',
        'billing.record-responsibility@1',
        'billing.read-claim-document@1',
        'billing.note-revision@1',
        'billing.find-code@1',
        'billing.find-medicare-locality@1',
        'billing.medicare-allowed@1',
        'billing.find-zip-place@1',
        'billing.find-hospital@1',
        'billing.payment-line@1',
        'billing.set-claim-payers@1',
        'billing.post-claim-payment@1',
        'billing.add-claim-document@1',
        'billing.match-payers@1',
        'billing.link-payer@1',
        'billing.read-narrative@1',
        'billing.attach-cycle@1',
        'billing.read-claim-ledger@1',
        'billing.record-claim-step@1',
        'billing.record-claim-event@1',
        'billing.issue-statement@1',
        'billing.prepare-837p@1',
        'billing.file-837p@1',
        'billing.follow-claim@1',
        'billing.send-837p@1',
        'billing.close-claim@1',
        'billing.read-payer-file@1',
        'billing.apply-payer-file@1',
        'billing.send-270@1',
        'billing.send-276@1',
        'billing.latest-claim-status@1',
        'billing.read-signature@1',
        'billing.issue-when@1',
        'billing.issue-for-each@1',
        'billing.read-denial@1',
        'billing.read-payer-response@1',
        'billing.read-payer@1',
        'billing.read-appeal@1',
        'billing.read-refund@1',
        'billing.read-patient-balance@1',
        'billing.record-refund@1',
        'billing.protect-balance@1',
        'billing.skip-remaining-payers@1',
        'billing.add-payer@1',
        'billing.build-appeal-packet@1',
        'billing.with-frequency@1',
        'billing.agency-today@1',
        'billing.find-deadlines@1',
        'billing.raise-task@1',
        'billing.issue-facility-invoices@1'
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

  it('runs every node against the storage it is given', async () => {
    const claims = memoryClaims();
    const follow = createBillingNodes(billingStores({ claims: claims.store })).find(
      (n) => n.type === 'billing.follow-claim'
    );
    if (!follow) throw new Error('No follow-claim node');
    await invokeNode(follow, { inputs: { claimId: 'c1' } });
    assert.deepEqual(claims.attached, ['claim:c1']);
  });

  it('documents every pin and exit and tags every node with a level', () => {
    const nodes = createBillingNodes(null);
    assert.deepEqual(nodes.flatMap(nodeDocumentationIssues), []);
    assert.deepEqual(
      nodes.filter((n) => n.level !== 'basic').map((n) => [n.type, n.level]),
      [
        ['billing.attach-cycle', 'advanced'],
        ['billing.record-claim-step', 'advanced'],
        ['billing.with-frequency', 'advanced']
      ]
    );
    const match = nodes.find((n) => n.type === 'billing.match-patient');
    assert.deepEqual(Object.keys(match?.exits ?? {}), [
      'matched',
      'unmatched',
      'review',
      'incomplete'
    ]);
  });
});
