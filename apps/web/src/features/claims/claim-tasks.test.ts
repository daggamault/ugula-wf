import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ClaimCoverage } from '../../shared/claims/claim-detail.ts';
import { claimTaskGroups, waitForTask } from './claim-tasks.tsx';

const act = () => {
  const done: string[] = [];
  return {
    done,
    act: {
      onStart: (key: string) => void done.push(key),
      onCheckEligibility: () => void done.push('check'),
      onRestart: () => void done.push('restart')
    }
  };
};

const payer = { id: 'c' } as ClaimCoverage;

describe('claimTaskGroups', () => {
  it('offers every claim task and the eligibility and restart actions on an open claim', () => {
    const { done, act: on } = act();
    const [tasks, actions] = claimTaskGroups(
      { status: 'submitted', cycle_status: 'suspended', coverages: [payer] },
      null,
      on
    );
    assert.deepEqual(
      tasks?.items.map((i) => [i.label, i.disabledReason]),
      [
        ['Correct Claim Data', undefined],
        ['Change Payers', undefined],
        ['Set Responsible Facility', undefined],
        ['Add Document', undefined],
        ['Chase Document', undefined],
        ['Log Records Request', undefined],
        ['Post Payment', undefined]
      ]
    );
    for (const item of [...(tasks?.items ?? []), ...(actions?.items ?? [])]) item.onSelect();
    assert.deepEqual(done.slice(-3), ['billing.post-payment', 'check', 'restart']);
    assert.deepEqual(
      actions?.items.map((i) => i.disabledReason),
      [undefined, 'The payer cycle has not stopped.']
    );
  });

  it('lets a draft take only documents, a stopped cycle restart, and a closed claim nothing', () => {
    const { act: on } = act();
    const [draft] = claimTaskGroups(
      { status: 'draft', cycle_status: null, coverages: [] },
      null,
      on
    );
    assert.deepEqual(
      draft?.items.filter((i) => !i.disabledReason).map((i) => i.label),
      ['Add Document']
    );
    const [, stopped] = claimTaskGroups(
      { status: 'submitted', cycle_status: 'failed', coverages: [] },
      null,
      on
    );
    assert.deepEqual(
      stopped?.items.map((i) => i.disabledReason),
      ['The claim has no payers.', undefined]
    );
    const closed = claimTaskGroups(
      { status: 'paid', cycle_status: null, coverages: [payer] },
      null,
      on
    );
    assert.ok(
      closed.flatMap((g) => g.items).every((i) => i.disabledReason === 'This claim is closed.')
    );
  });
});

describe('waitForTask', () => {
  it('asks until the run has opened its task', async () => {
    const answers = [null, null, 't1'];
    const slept: number[] = [];
    assert.equal(
      await waitForTask(
        async () => answers.shift() ?? null,
        async (ms) => void slept.push(ms)
      ),
      't1'
    );
    assert.deepEqual(slept, [500, 500]);
  });

  it('gives up after a while', async () => {
    let asked = 0;
    assert.equal(
      await waitForTask(
        async () => {
          asked++;
          return null;
        },
        async () => undefined
      ),
      null
    );
    assert.equal(asked, 30);
  });
});
