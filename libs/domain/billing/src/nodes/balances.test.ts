import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { invokeNode } from '@ugula/graph/testing';
import { billingStores } from '../testing.ts';
import { balanceNodes, planTermsProblem } from './balances.ts';
import type { BalanceStore } from './stores.ts';

const recording = (refuse: string | null = null) => {
  const calls: unknown[][] = [];
  const store: BalanceStore = {
    startPlan: async (...args) => {
      calls.push(['startPlan', ...args]);
      return refuse ? { status: 'refused', reason: refuse } : { status: 'started' };
    },
    missPlan: async (...args) => {
      calls.push(['missPlan', ...args]);
    },
    endPlan: async (...args) => {
      calls.push(['endPlan', ...args]);
    },
    placeCollections: async (...args) => {
      calls.push(['placeCollections', ...args]);
    },
    creditTargets: async (...args) => {
      calls.push(['creditTargets', ...args]);
      return refuse ? [] : [{ claimId: 'c2', reference: 'PCR-2 · Jane Doe', balanceCents: 12_345 }];
    },
    transferCredit: async (...args) => {
      calls.push(['transferCredit', ...args]);
      return refuse ? { status: 'refused', reason: refuse } : { status: 'transferred', cents: 500 };
    }
  };
  const nodes = balanceNodes(() => billingStores({ balances: store }));
  const node = (type: string) => {
    const n = nodes.find((x) => x.type === type);
    if (!n) throw new Error(`No ${type}`);
    return n;
  };
  return { calls, node };
};

const terms = { installmentCents: 5_000, intervalDays: 30, firstDueOn: '2026-12-01' };

describe('planTermsProblem', () => {
  it('refuses an empty installment, an interval past a year and a missing date', () => {
    assert.equal(planTermsProblem(terms), null);
    assert.match(planTermsProblem({ ...terms, installmentCents: 0 }) ?? '', /more than/);
    assert.match(planTermsProblem({ ...terms, intervalDays: 400 }) ?? '', /1 to 366 days/);
    assert.match(planTermsProblem({ ...terms, firstDueOn: '12/01' }) ?? '', /not a date/);
    assert.match(planTermsProblem({ ...terms, firstDueOn: null }) ?? '', /not a date/);
  });
});

describe('balanceNodes', () => {
  it('starts a plan with who set it up, and refuses bad terms without saving', async () => {
    const { calls, node } = recording();
    const started = await invokeNode(node('billing.start-payment-plan'), {
      inputs: { claimId: 'c1', ...terms, createdBy: 'u1' }
    });
    assert.equal(started.pin, 'started');
    assert.deepEqual(calls, [['startPlan', 'run', 'c1', 'key', { ...terms, createdBy: 'u1' }]]);
    const bad = await invokeNode(node('billing.start-payment-plan'), {
      inputs: { claimId: 'c1', ...terms, intervalDays: 0 }
    });
    assert.deepEqual(
      [bad.pin, bad.outputs.reason],
      ['refused', 'Installments are 1 to 366 days apart']
    );
    assert.equal(calls.length, 1);
    const taken = recording('The claim already has an active payment plan');
    const again = await invokeNode(taken.node('billing.start-payment-plan'), {
      inputs: { claimId: 'c1', ...terms }
    });
    assert.deepEqual(
      [again.pin, again.outputs.reason],
      ['refused', 'The claim already has an active payment plan']
    );
  });

  it('records a missed installment and ends a plan, with a note by default', async () => {
    const { calls, node } = recording();
    await invokeNode(node('billing.record-plan-miss'), { inputs: { claimId: 'c1' } });
    await invokeNode(node('billing.end-payment-plan'), {
      inputs: { claimId: 'c1', status: 'defaulted', note: 'Three missed' }
    });
    await invokeNode(node('billing.end-payment-plan'), {
      inputs: { claimId: 'c1', status: 'cancelled' }
    });
    assert.deepEqual(calls, [
      ['missPlan', 'run', 'c1', 'key', 'Installment missed; the plan was kept'],
      ['endPlan', 'run', 'c1', 'key', { status: 'defaulted', note: 'Three missed' }],
      ['endPlan', 'run', 'c1', 'key', { status: 'cancelled', note: 'Payment plan cancelled' }]
    ]);
    await assert.rejects(
      () =>
        invokeNode(node('billing.end-payment-plan'), {
          inputs: { claimId: 'c1', status: 'active' }
        }),
      /Unknown plan ending "active"/
    );
  });

  it('places a claim with the collection agency at its fee', async () => {
    const { calls, node } = recording();
    await invokeNode(node('billing.record-collections-placement'), {
      inputs: { claimId: 'c1', agencyName: ' Acme Recovery ', feePct: 30 }
    });
    assert.deepEqual(calls, [
      ['placeCollections', 'run', 'c1', 'key', { agencyName: 'Acme Recovery', feePct: 30 }]
    ]);
    await assert.rejects(
      () =>
        invokeNode(node('billing.record-collections-placement'), {
          inputs: { claimId: 'c1', agencyName: 'Acme', feePct: 120 }
        }),
      /not between 0 and 100/
    );
  });

  it("offers the patient's other open claims and moves a credit to one", async () => {
    const { calls, node } = recording();
    const { outputs } = await invokeNode(node('billing.credit-targets'), {
      inputs: { claimId: 'c1' }
    });
    assert.deepEqual(outputs.options, {
      toClaimId: [{ value: 'c2', label: 'PCR-2 · Jane Doe · $123.45 open' }]
    });
    const moved = await invokeNode(node('billing.transfer-credit'), {
      inputs: { claimId: 'c1', toClaimId: 'c2' }
    });
    assert.deepEqual([moved.pin, moved.outputs.transferredCents], ['transferred', 500]);
    assert.deepEqual(calls.at(-1), [
      'transferCredit',
      'run',
      'c1',
      'key',
      { toClaimId: 'c2', note: '' }
    ]);
    const none = await invokeNode(node('billing.transfer-credit'), { inputs: { claimId: 'c1' } });
    assert.deepEqual(
      [none.pin, none.outputs.reason],
      ['refused', 'Choose the claim to move the credit to']
    );
    const empty = recording('No credit is left');
    const choices = await invokeNode(empty.node('billing.credit-targets'), {
      inputs: { claimId: 'c1' }
    });
    assert.equal(choices.outputs.options, null);
    const refused = await invokeNode(empty.node('billing.transfer-credit'), {
      inputs: { claimId: 'c1', toClaimId: 'c2' }
    });
    assert.deepEqual([refused.pin, refused.outputs.reason], ['refused', 'No credit is left']);
  });
});
