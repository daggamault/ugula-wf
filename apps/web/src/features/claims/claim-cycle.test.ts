import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { describeCycle, describeProgress } from './claim-cycle.tsx';

const medicare = { id: 'cov-m', payer: 'Medicare' };

describe('describeProgress', () => {
  it('tells billers what the claim cycle is doing', () => {
    assert.match(
      describeProgress({ step: 'await', coverage: medicare, waitMs: 1, balanceCents: 1 }),
      /^Waiting on Medicare/
    );
    assert.match(
      describeProgress({ step: 'followUp', coverage: medicare, balanceCents: 1 }),
      /follow-up task is waiting/
    );
    assert.match(
      describeProgress({ step: 'review', coverage: medicare, balanceCents: 1 }),
      /^Needs review before it goes to Medicare/
    );
    assert.match(
      describeProgress({ step: 'reconcile', coverage: medicare, balanceCents: 1 }),
      /reconcile task is waiting/
    );
    assert.equal(
      describeProgress({ step: 'statement', statement: 2, balanceCents: 1 }),
      'Sending patient statement 2 of 3.'
    );
    assert.match(
      describeProgress({ step: 'submit', coverage: medicare, balanceCents: 1 }),
      /^Approved. Creating its 837P file for Medicare/
    );
    assert.match(
      describeProgress({ step: 'confirmPayers', balanceCents: 1 }),
      /No payer is on this claim/
    );
    assert.match(
      describeProgress({ step: 'reviewPatient', balanceCents: 1 }),
      /before the patient is billed/
    );
    assert.match(
      describeProgress({ step: 'overpaid', balanceCents: -2_500 }),
      /^\$25\.00 more has been paid/
    );
    assert.match(
      describeProgress({ step: 'awaitPatient', waitMs: 1, balanceCents: 1 }),
      /^Waiting on the patient/
    );
    assert.match(
      describeProgress({ step: 'collections', balanceCents: 1 }),
      /balance review task is waiting/
    );
    assert.equal(describeProgress({ step: 'closed', balanceCents: 0 }), 'Paid in full. Closing.');
  });
});

describe('describeCycle', () => {
  const waiting = { step: 'await', coverage: medicare, waitMs: 1, balanceCents: 1 } as const;
  it('reports a stopped, stuck or missing cycle instead of the expected next step', () => {
    assert.equal(
      describeCycle({ status: 'submitted', cycle_status: 'suspended' }, waiting)?.intent,
      'info'
    );
    const failed = describeCycle({ status: 'submitted', cycle_status: 'failed' }, waiting);
    assert.equal(failed?.intent, 'danger');
    assert.match(failed?.text ?? '', /payer cycle failed/);
    assert.match(
      describeCycle({ status: 'submitted', cycle_status: 'cancelled' }, waiting)?.text ?? '',
      /was cancelled/
    );
    assert.match(
      describeCycle({ status: 'submitted', cycle_status: 'faulted' }, waiting)?.text ?? '',
      /stuck run task/
    );
    const missing = describeCycle({ status: 'ready', cycle_status: null }, null);
    assert.deepEqual(
      [missing?.intent, missing?.stopped, missing?.restartable],
      ['warning', true, true]
    );
    assert.equal(
      describeCycle({ status: 'submitted', cycle_status: 'faulted' }, waiting)?.restartable,
      false
    );
    assert.equal(describeCycle({ status: 'submitted', cycle_status: 'running' }, null), null);
    assert.equal(
      describeCycle(
        { status: 'submitted', cycle_status: 'running' },
        { step: 'overpaid', balanceCents: -1 }
      )?.intent,
      'warning'
    );
    assert.equal(describeCycle({ status: 'paid', cycle_status: 'completed' }, null), null);
    const filing = describeCycle(
      { status: 'ready', cycle_status: 'running' },
      { step: 'submit', coverage: medicare, balanceCents: 1 }
    );
    assert.equal(filing?.intent, 'info');
    const draft = describeCycle({ status: 'draft', cycle_status: null }, null);
    assert.deepEqual([draft?.intent, draft?.restartable], ['info', false]);
  });
});
