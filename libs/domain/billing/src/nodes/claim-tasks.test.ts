import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Values } from '@ugula/graph';
import { invokeNode } from '@ugula/graph/testing';
import { billingStores } from '../testing.ts';
import { claimTaskNodes } from './claim-tasks.ts';
import type { ClaimTaskStore } from './stores.ts';

const setup = (refuse: string | null = null) => {
  const calls: [string, unknown][] = [];
  const no = { status: 'refused', reason: refuse ?? '' } as const;
  const claimTasks: ClaimTaskStore = {
    setPayers: async (_, claimId, payers) => {
      calls.push(['payers', { claimId, payers }]);
      return refuse ? no : { status: 'saved' };
    },
    postPayment: async (_, claimId, key, payment, postedBy) => {
      calls.push(['payment', { claimId, key, payment, postedBy }]);
      return refuse ? no : { status: 'posted', balanceCents: 1_200 };
    },
    addDocument: async (_, claimId, key, document) => {
      calls.push(['document', { claimId, key, document }]);
      return refuse ? no : { status: 'added', documentId: 'd1' };
    }
  };
  const nodes = claimTaskNodes(() => billingStores({ claimTasks }));
  const run = (type: string, inputs: Values) => {
    const node = nodes.find((n) => n.type === `billing.${type}`);
    if (!node) throw new Error(`No node ${type}`);
    return invokeNode(node, { inputs });
  };
  return { calls, run };
};

describe('claimTaskNodes', () => {
  it('sets the payers by name in billing order', async () => {
    const { calls, run } = setup();
    const saved = await run('set-claim-payers', { claimId: 'c1', payers: [' Blue ', 'Medicare'] });
    assert.deepEqual([saved.pin, saved.outputs.reason], ['saved', null]);
    assert.deepEqual(calls, [['payers', { claimId: 'c1', payers: ['Blue', 'Medicare'] }]]);
  });

  it('refuses payers listed twice without touching the claim, and says why the store refused', async () => {
    const { calls, run } = setup();
    const twice = await run('set-claim-payers', { claimId: 'c1', payers: ['A', 'a'] });
    assert.deepEqual([twice.pin, twice.outputs.reason], ['refused', 'a is listed twice']);
    assert.equal(calls.length, 0);
    const busy = await setup('Medicare already has billing activity').run('set-claim-payers', {
      claimId: 'c1',
      payers: []
    });
    assert.deepEqual(busy.outputs.reason, 'Medicare already has billing activity');
  });

  it('posts a payment in cents once per step, by the biller who entered it', async () => {
    const { calls, run } = setup();
    const posted = await run('post-claim-payment', {
      claimId: 'c1',
      coverageId: 'cov-1',
      paid: 80,
      adjusted: 20,
      reasonCodes: ['CO-45 20'],
      postedBy: 'u1'
    });
    assert.deepEqual([posted.pin, posted.outputs.balanceCents], ['posted', 1_200]);
    const [, call] = calls[0] ?? [];
    assert.deepEqual(call, {
      claimId: 'c1',
      key: 'key',
      postedBy: 'u1',
      payment: {
        kind: 'response',
        coverageId: 'cov-1',
        paidCents: 8_000,
        adjustedCents: 2_000,
        paidOn: null,
        checkNumber: null,
        payerClaimNumber: null,
        adjustments: [{ group: 'CO', reason: '45', cents: 2_000 }],
        note: ''
      }
    });
  });

  it('refuses a payment it cannot read, or one the claim refuses', async () => {
    const { calls, run } = setup();
    const empty = await run('post-claim-payment', { claimId: 'c1' });
    assert.deepEqual(
      [empty.pin, empty.outputs.reason],
      ['refused', 'A patient payment needs an amount']
    );
    assert.equal(calls.length, 0);
    const closed = await setup('Claim is already closed').run('post-claim-payment', {
      claimId: 'c1',
      paid: 5
    });
    assert.deepEqual([closed.pin, closed.outputs.reason], ['refused', 'Claim is already closed']);
  });

  it('adds an uploaded file as a claim document of its kind', async () => {
    const { calls, run } = setup();
    const file = { bucket: 'b', key: 'imports/a1/uploads/x/pcs.pdf' };
    const added = await run('add-claim-document', {
      claimId: 'c1',
      kind: 'pcs',
      signedOn: '2026-09-30',
      file,
      addedBy: 'u1'
    });
    assert.deepEqual([added.pin, added.outputs.documentId], ['added', 'd1']);
    assert.deepEqual(calls, [
      [
        'document',
        {
          claimId: 'c1',
          key: 'key',
          document: { kind: 'pcs', signedOn: '2026-09-30', file, addedBy: 'u1' }
        }
      ]
    ]);
    const unknown = await run('add-claim-document', { claimId: 'c1', kind: 'xray', file });
    assert.deepEqual(
      [unknown.pin, unknown.outputs.reason],
      ['refused', 'Choose what kind of document it is']
    );
    const refused = await setup('Not a document').run('add-claim-document', {
      claimId: 'c1',
      kind: 'abn',
      file
    });
    assert.deepEqual([refused.pin, refused.outputs.documentId], ['refused', null]);
  });
});
