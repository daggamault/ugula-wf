import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { NodeDef } from '@ugula/graph';
import { invokeNode } from '@ugula/graph/testing';
import type { LedgerCoverage } from '../claims.ts';
import { billingStores, memoryClaims } from '../testing.ts';
import { exchangeNodes } from './exchange.ts';
import type { ClaimStatusCheck, EligibilityCheck } from './stores.ts';

const setup = (
  eligibility: EligibilityCheck,
  status: ClaimStatusCheck,
  coverages?: LedgerCoverage[]
) => {
  const calls: unknown[][] = [];
  const claims = memoryClaims(coverages ? { coverages } : {});
  const nodes = exchangeNodes(() =>
    billingStores({
      claims: claims.store,
      exchange: {
        checkEligibility: async (...args) => {
          calls.push(['270', ...args]);
          return eligibility;
        },
        checkClaimStatus: async (...args) => {
          calls.push(['276', ...args]);
          return status;
        }
      }
    })
  );
  const node = (type: string) => {
    const found = nodes.find((n) => n.type === `billing.${type}`);
    if (!found) throw new Error(`No ${type}`);
    return found as NodeDef;
  };
  return { node, calls, claims };
};

const review = { reference: 'cov-1', claimId: 'c1', outcome: 'review' as const, message: 'MA' };

describe('exchangeNodes', () => {
  it('checks eligibility in real time, in batch, or says why it cannot', async () => {
    const answered = setup(
      { status: 'answered', fileName: '271-1.x12', reviews: [review] },
      { status: 'unavailable', reason: '' }
    );
    const out = await invokeNode(answered.node('send-270'), { inputs: { claimId: 'c1' } });
    assert.deepEqual(
      [out.pin, out.outputs],
      ['answered', { fileName: '271-1.x12', reviews: [review], sentAs: null, reason: null }]
    );
    await invokeNode(answered.node('send-270'), { inputs: { claimId: 'c1', force: true } });
    assert.deepEqual(answered.calls, [
      ['270', 'run', 'c1', 'key', false],
      ['270', 'run', 'c1', 'key', true]
    ]);
    const sent = await invokeNode(
      setup(
        { status: 'sent', sentAs: '270-1.ELG', reason: 'Timed out' },
        { status: 'unavailable', reason: '' }
      ).node('send-270'),
      { inputs: { claimId: 'c1' } }
    );
    assert.deepEqual(
      [sent.pin, sent.outputs.sentAs, sent.outputs.reason, sent.outputs.reviews],
      ['sent', '270-1.ELG', 'Timed out', []]
    );
    const none = await invokeNode(
      setup(
        { status: 'unavailable', reason: 'No clearinghouse connection' },
        { status: 'unavailable', reason: '' }
      ).node('send-270'),
      { inputs: { claimId: 'c1' } }
    );
    assert.deepEqual(
      [none.pin, none.outputs.reason],
      ['unavailable', 'No clearinghouse connection']
    );
  });

  it('checks claim status for the payer being billed, outputting what to wait from', async () => {
    const answered = setup(
      { status: 'unavailable', reason: '' },
      { status: 'answered', note: 'Paid (F1:65): Claim has been paid' }
    );
    const out = await invokeNode(answered.node('send-276'), {
      inputs: { claimId: 'c1', coverageId: 'cov-1' }
    });
    assert.deepEqual(
      [out.pin, out.outputs.status],
      ['answered', 'Paid (F1:65): Claim has been paid']
    );
    assert.deepEqual(answered.calls, [['276', 'run', 'c1', 'key', 'cov-1']]);
    const sent = await invokeNode(
      setup(
        { status: 'unavailable', reason: '' },
        { status: 'sent', sentAs: '276-1.CLS', reason: null, signalsSeen: 4 }
      ).node('send-276'),
      { inputs: { claimId: 'c1', coverageId: 'cov-1' } }
    );
    assert.deepEqual(
      [sent.pin, sent.outputs.sentAs, sent.outputs.signalsSeen],
      ['sent', '276-1.CLS', 4]
    );
    const unavailable = await invokeNode(
      setup(
        { status: 'unavailable', reason: '' },
        { status: 'unavailable', reason: 'No submission to ask about' }
      ).node('send-276'),
      { inputs: { claimId: 'c1', coverageId: 'cov-1' } }
    );
    assert.deepEqual(
      [unavailable.pin, unavailable.outputs],
      [
        'unavailable',
        { status: null, sentAs: null, signalsSeen: null, reason: 'No submission to ask about' }
      ]
    );
    await assert.rejects(
      () => invokeNode(answered.node('send-276'), { inputs: { claimId: 'c1', coverageId: ' ' } }),
      /No payer to ask about the claim/
    );
  });

  it('reads the latest claim status logged for the payer being billed', async () => {
    const s = setup({ status: 'unavailable', reason: '' }, { status: 'unavailable', reason: '' });
    const out = await invokeNode(s.node('latest-claim-status'), { inputs: { claimId: 'c1' } });
    assert.equal(out.outputs.status, null);
    const event = {
      kind: 'claim_status' as const,
      coverageId: 'cov-1',
      paidCents: 0,
      adjustedCents: 0,
      payerClaimNumber: null,
      paidOn: null,
      adjustments: [],
      note: 'Pending (P1:20)',
      at: '2026-02-01T00:00:00.000Z',
      key: 'k'
    };
    const known = setup(
      { status: 'unavailable', reason: '' },
      { status: 'unavailable', reason: '' },
      [{ id: 'cov-1', payer: 'Medicare' }]
    );
    known.claims.events.push(event);
    const latest = await invokeNode(known.node('latest-claim-status'), {
      inputs: { claimId: 'c1' }
    });
    assert.equal(latest.outputs.status, 'Pending (P1:20)');
    await assert.rejects(
      () => invokeNode(s.node('latest-claim-status'), { inputs: { claimId: 'missing' } }),
      /does not exist/
    );
  });
});
