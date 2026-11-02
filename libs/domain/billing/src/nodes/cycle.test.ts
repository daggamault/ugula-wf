import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { NodeDef, Values } from '@ugula/graph';
import { invokeNode } from '@ugula/graph/testing';
import { billingStores, memoryClaims, type RecordedEvent } from '../testing.ts';
import { cycleNodes } from './cycle.ts';

const run = (node: NodeDef, inputs: Values) =>
  invokeNode(node, { inputs, now: new Date('2026-01-01T00:00:00.000Z') });

const event = (kind: RecordedEvent['kind'], coverageId: string | null, at: string) => ({
  kind,
  coverageId,
  key: kind,
  note: '',
  paidCents: 0,
  adjustedCents: 0,
  at
});

describe('cycleNodes', () => {
  it('walks a claim through its payer cycle and closes it', async () => {
    const claims = memoryClaims({
      coverages: [
        { id: 'cov-Medicare', payer: 'Medicare' },
        { id: 'cov-Blue', payer: 'Blue' }
      ],
      totalCents: 100_000,
      signalsSeen: 3,
      reference: 'PCR-1 · Jane Doe'
    });
    const stores = billingStores({ claims: claims.store });
    const nodes = cycleNodes(() => stores);
    const node = (type: string) => {
      const found = nodes.find((n) => n.type === `billing.${type}`);
      if (!found) throw new Error(`No ${type} node`);
      return found;
    };
    const [attach, step, record, close, issue] = [
      'attach-cycle',
      'claim-step',
      'record-claim-event',
      'close-claim',
      'issue-statement'
    ].map(node);
    if (!attach || !step || !record || !close || !issue) throw new Error('Missing cycle nodes');

    await run(attach, { claimId: 'c1', cycleRunId: 'run-9' });
    assert.deepEqual(claims.attached, ['run-9']);
    await assert.rejects(
      async () => run(attach, { claimId: 'c1', cycleRunId: ' ' }),
      /No cycle run/
    );

    const next = async (inputs: Values = {}) => run(step, { claimId: 'c1', ...inputs });
    assert.equal((await next()).pin, 'review');
    await run(record, { claimId: 'c1', kind: 'approved', coverageId: 'cov-Blue' });
    assert.equal(claims.events.length, 0);
    await run(record, { claimId: 'c1', kind: 'approved', coverageId: 'cov-Medicare' });
    const submit = await next();
    assert.deepEqual(
      [submit.pin, submit.outputs],
      [
        'submit',
        {
          coverageId: 'cov-Medicare',
          payer: 'Medicare',
          statementNumber: null,
          balanceCents: 100_000,
          waitMs: null,
          signalsSeen: 3,
          reference: 'PCR-1 · Jane Doe'
        }
      ]
    );
    await assert.rejects(
      async () => run(record, { claimId: 'c1', kind: 'submitted', coverageId: 'cov-Medicare' }),
      /Unknown claim event/
    );
    claims.events.push(event('submitted', 'cov-Medicare', '2026-01-01T00:00:00.000Z'));
    assert.equal((await next()).pin, 'await');
    assert.equal((await next({ payerWaitDays: 2 })).outputs.waitMs, 2 * 86_400_000);
    await run(record, { claimId: 'c1', kind: 'payer_skipped', coverageId: 'cov-Medicare' });
    const before = claims.events.length;
    await run(record, { claimId: 'c1', kind: 'follow_up', coverageId: 'cov-Medicare' });
    assert.equal(claims.events.length, before);
    await run(record, { claimId: 'c1', kind: 'payer_skipped', coverageId: 'cov-Blue' });
    assert.equal((await next()).outputs.statementNumber, 1);
    claims.events.push(event('statement', null, '2025-01-01T00:00:00.000Z'));
    assert.equal((await next({ statementCount: 1 })).pin, 'collections');
    await assert.rejects(
      async () => run(record, { claimId: 'c1', kind: 'paid' }),
      /Unknown claim event/
    );
    await assert.rejects(
      async () => run(issue, { claimId: 'c1', statementNumber: 0 }),
      /needs a number/
    );
    await assert.rejects(
      async () => run(issue, { claimId: 'c1', statementNumber: 1 }),
      /statement store is not used/
    );
    await run(close, { claimId: 'c1', status: 'written_off' });
    await run(close, { claimId: 'c1', status: 'void' });
    assert.deepEqual(claims.closed, ['written_off', 'void']);
    assert.deepEqual(claims.statuses, [
      'needs_review',
      'ready',
      'submitted',
      'submitted',
      'patient_balance',
      'balance_review'
    ]);
    await assert.rejects(
      async () => run(close, { claimId: 'c1', status: 'gone' }),
      /Unknown claim status/
    );
    await assert.rejects(async () => run(step, { claimId: 'c9' }), /does not exist/);
  });
});
