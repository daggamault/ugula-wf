import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ClaimDetail } from '../../shared/claims/claim-detail.ts';
import { claimTaskGroups, waitForTask } from './claim-tasks.tsx';
import type { ClaimProgress } from './client.ts';

type Claim = Pick<ClaimDetail, 'status' | 'cycle_status' | 'coverages'>;

const recording = () => {
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

const payer = { id: 'c' } as Claim['coverages'][number];

const open: Claim = { status: 'submitted', cycle_status: 'suspended', coverages: [payer] };

const waiting: ClaimProgress = {
  step: 'await',
  coverage: { id: 'c', payer: 'Medicare', claimFiling: null },
  waitMs: 1,
  balanceCents: 1
};

const groupsOf = (claim: Claim, progress: ClaimProgress | null = waiting) =>
  claimTaskGroups(claim, progress, recording().act);

const reasons = (claim: Claim, progress?: ClaimProgress | null) =>
  groupsOf(claim, progress).map((g) => [g.label, g.items.map((i) => [i.label, i.disabledReason])]);

const TASKS = [
  'Correct Claim Data',
  'Change Responsible Party',
  'Discover Insurance',
  'Add Document',
  'Chase Document',
  'Log Records Request',
  'Post Payment',
  'Set Up Payment Plan'
];

describe('claimTaskGroups', () => {
  it('offers every claim task with what it does, then eligibility and restart actions', () => {
    assert.deepEqual(
      groupsOf(open).map((g) => [g.label, g.items.map((i) => [i.label, i.description])]),
      [
        [
          'Tasks',
          [
            [
              'Correct Claim Data',
              'Change what goes on the 837P; charges are priced again when needed.'
            ],
            [
              'Change Responsible Party',
              'Add, reorder or remove the payers, or bill a facility for the trip instead.'
            ],
            [
              'Discover Insurance',
              'Search the payers that accept searches for coverage the patient did not report.'
            ],
            ['Add Document', 'Upload a facesheet, certification, signature form, ABN or MSP form.'],
            ['Chase Document', 'Get a missing document by a due date.'],
            ['Log Records Request', 'A payer asked for records; send them by the due date.'],
            ['Post Payment', 'A payment or refund that came by mail, phone or card.'],
            ['Set Up Payment Plan', 'Let the patient pay the balance in installments.']
          ]
        ],
        [
          'Actions',
          [
            ['Check Eligibility', 'Ask every payer again whether the coverage is active.'],
            ['Restart Payer Cycle', 'Start the payer cycle again after it stopped.']
          ]
        ]
      ]
    );
  });

  it('starts the chosen task or action', () => {
    const { done, act } = recording();
    for (const item of claimTaskGroups(open, waiting, act).flatMap((g) => g.items)) item.onSelect();
    assert.deepEqual(done, [
      'billing.correct-claim-data',
      'billing.change-responsible-party',
      'billing.discover-insurance',
      'billing.receive-document',
      'billing.chase-document',
      'billing.log-records-request',
      'billing.post-payment',
      'billing.set-up-payment-plan',
      'check',
      'restart'
    ]);
  });

  it('allows every task on an open claim but no restart while the cycle runs', () => {
    assert.deepEqual(reasons(open), [
      ['Tasks', TASKS.map((t) => [t, undefined])],
      [
        'Actions',
        [
          ['Check Eligibility', undefined],
          ['Restart Payer Cycle', 'The payer cycle has not stopped.']
        ]
      ]
    ]);
  });

  it('restarts a cycle that stopped and checks no eligibility without payers', () => {
    assert.deepEqual(reasons({ status: 'submitted', cycle_status: 'failed', coverages: [] })[1], [
      'Actions',
      [
        ['Check Eligibility', 'The claim has no payers.'],
        ['Restart Payer Cycle', undefined]
      ]
    ]);
  });

  it('restarts no cycle that faulted, since a stuck run task decides it', () => {
    const [, actions] = groupsOf({ ...open, cycle_status: 'faulted' });
    assert.equal(actions?.items[1]?.disabledReason, 'The payer cycle has not stopped.');
  });

  it('lets a draft take only documents', () => {
    const draft = 'This claim is still a draft. Finish its PCR tasks first.';
    assert.deepEqual(reasons({ status: 'draft', cycle_status: null, coverages: [payer] }, null), [
      ['Tasks', TASKS.map((t) => [t, t === 'Add Document' ? undefined : draft])],
      [
        'Actions',
        [
          ['Check Eligibility', draft],
          ['Restart Payer Cycle', draft]
        ]
      ]
    ]);
  });

  it('allows only posting a payment on a closed claim, and nothing on a void one', () => {
    const closed = 'This claim is closed.';
    assert.deepEqual(reasons({ status: 'paid', cycle_status: null, coverages: [payer] }, null), [
      ['Tasks', TASKS.map((t) => [t, t === 'Post Payment' ? undefined : closed])],
      [
        'Actions',
        [
          ['Check Eligibility', closed],
          ['Restart Payer Cycle', closed]
        ]
      ]
    ]);
    assert.deepEqual(reasons({ status: 'void', cycle_status: null, coverages: [payer] }, null)[0], [
      'Tasks',
      TASKS.map((t) => [t, closed])
    ]);
  });
});

describe('waitForTask', () => {
  it('asks every half second until the run has opened its task', async () => {
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

  it('does not wait when the task is already open', async () => {
    const slept: number[] = [];
    assert.equal(
      await waitForTask(
        async () => 't1',
        async (ms) => void slept.push(ms)
      ),
      't1'
    );
    assert.deepEqual(slept, []);
  });

  it('gives up after thirty tries', async () => {
    let asked = 0;
    let slept = 0;
    assert.equal(
      await waitForTask(
        async () => {
          asked++;
          return null;
        },
        async () => void slept++
      ),
      null
    );
    assert.deepEqual([asked, slept], [30, 30]);
  });
});
