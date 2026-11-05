import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Json, RunState, Values } from '@ugula/graph';
import { type RunJob, timeout } from '@ugula/run-queue';
import type { ClaimedRun } from './run-lease.ts';
import type { TaskInsert } from './run-tasks.ts';
import type { ChildRun, ParentWait, RunPatch, RunTx } from './run-tx.ts';
import {
  cancelRun,
  childrenPayload,
  FAULT_OUTCOMES,
  faultFields,
  isChildWait,
  notifyParent,
  readableError,
  settleRun,
  stallRun
} from './settle.ts';

type FakeOptions = {
  parent?: ParentWait;
  children?: ChildRun[];
  version?: string;
  active?: string[];
  received?: number;
  reference?: string;
  recovered?: string[];
};

const fakeTx = (opts: FakeOptions = {}) => {
  const calls = {
    saved: [] as RunPatch[],
    steps: 0,
    tasks: [] as TaskInsert[],
    jobs: [] as RunJob[],
    cancelledTasks: [] as string[],
    spawned: [] as Values[][],
    recoveries: [] as [string, string, string][]
  };
  const tx: RunTx = {
    saveRun: async (_, patch) => {
      calls.saved.push(patch);
    },
    insertSteps: async (_, steps) => {
      calls.steps += steps.length;
    },
    insertTask: async (task) => {
      calls.tasks.push(task);
    },
    cancelTasks: async (runId) => {
      calls.cancelledTasks.push(runId);
    },
    findVersion: async () => opts.version,
    insertRun: async (_, __, inputs) => {
      calls.spawned.push([inputs]);
      return 'detached-1';
    },
    insertChildren: async (_, __, ___, inputs) => {
      calls.spawned.push(inputs);
      return inputs.map((_x, i) => `child-${i}`);
    },
    lockParent: async () => opts.parent,
    hasPendingChildren: async () =>
      (opts.children ?? []).some((c) => ['running', 'suspended', 'faulted'].includes(c.status)),
    children: async () => opts.children ?? [],
    activeChildren: async () => opts.active ?? [],
    lockSignal: async () => opts.received ?? 0,
    claimReference: async () => opts.reference ?? null,
    recoverDrafts: async (r, versionId, reason) => {
      calls.recoveries.push([r.id, versionId, reason]);
      return opts.recovered ?? [];
    },
    enqueue: async (jobs) => {
      calls.jobs.push(...jobs);
    },
    dropTimeout: async () => undefined
  };
  return { tx, calls };
};

const run: ClaimedRun = {
  id: 'run-1',
  lease: 'lease-1',
  agencyId: 't-1',
  versionId: 'v-1',
  parentId: null,
  parentWait: null,
  graphs: [],
  tables: [],
  inputs: {},
  state: null
};

const child: ClaimedRun = { ...run, id: 'child-a', parentId: 'parent-1', parentWait: '7' };

const cursor = { scope: 's1', node: 'n1', event: { type: 'resume' as const, payload: null } };

const state = (patch: Partial<RunState>): RunState => ({
  status: 'running',
  root: { type: 'demo.flow', version: 1 },
  seq: 9,
  scopes: {},
  stack: [],
  cursor: null,
  suspension: null,
  fault: null,
  result: null,
  ...patch
});

const waiting = (kind: string, data: Json) =>
  state({ status: 'suspended', suspension: { id: '7', kind, data, cursor, retry: false } });

describe('settleRun', () => {
  it('re-enqueues runs that ran out of budget and records steps', async () => {
    const { tx, calls } = fakeTx();
    const trace = [{ seq: 1 }, { seq: 2 }] as never[];
    await settleRun(tx, run, state({}), trace);
    assert.equal(calls.steps, 2);
    assert.equal(calls.saved[0]?.status, 'running');
    assert.deepEqual(calls.jobs, [{ runId: 'run-1', command: { type: 'advance' } }]);
  });

  it('stores results of completed runs', async () => {
    const { tx, calls } = fakeTx();
    const result = { pin: 'done', outputs: { total: 3 } };
    await settleRun(tx, run, state({ status: 'completed', result }), []);
    assert.deepEqual(calls.saved[0]?.result, result);
    assert.deepEqual(calls.jobs, []);
  });

  it('opens an exception task for faulted runs, named for the claim it works', async () => {
    const { tx, calls } = fakeTx({ reference: 'PCR-1 · Jane Doe' });
    const error = { message: 'payer service answered 503', path: 'sub/', node: 'call' };
    await settleRun(tx, run, state({ status: 'faulted', fault: { cursor, error } }), [], {
      title: 'Call payer',
      exits: ['then', 'failed'],
      outputs: ['status']
    });
    assert.deepEqual(calls.saved[0]?.error, error);
    assert.equal(calls.tasks[0]?.kind, 'fault');
    assert.equal(calls.tasks[0]?.waitId, 'fault:9');
    assert.equal(calls.tasks[0]?.title, 'Stuck at Call payer');
    assert.equal(calls.tasks[0]?.subject, 'PCR-1 · Jane Doe');
    assert.equal(
      calls.tasks[0]?.instructions,
      'Call payer: Payer service answered 503.\n\nRetry once the cause is fixed.'
    );
    assert.deepEqual(calls.tasks[0]?.fields, [
      {
        name: 'pin',
        type: 'string',
        label: 'Continue from',
        options: [
          { value: 'then', label: 'then' },
          { value: 'failed', label: 'failed' }
        ]
      }
    ]);
    assert.deepEqual(calls.tasks[0]?.outcomes, FAULT_OUTCOMES);
    assert.deepEqual(Object.keys(calls.tasks[0]?.hints ?? {}), FAULT_OUTCOMES);
  });

  it('asks only for the decisions that apply to the failed node', () => {
    assert.deepEqual(faultFields({ title: 'Fail', exits: [], outputs: ['x'] }), []);
    assert.deepEqual(faultFields(null), []);
  });

  it('explains database rule violations in plain words', () => {
    assert.equal(
      readableError(
        'new row for relation "claims" violates check constraint "claims_pickup_state_check"'
      ),
      'A saved value broke the rule claims pickup state check.'
    );
    assert.equal(
      readableError('duplicate key value violates unique constraint "x"'),
      'It would duplicate a record that already exists.'
    );
    assert.equal(
      readableError('null value in column "payer_name" of relation "claim_coverages"'),
      'Payer name is required.'
    );
    assert.equal(readableError('Error: no claim to work on'), 'No claim to work on.');
    assert.equal(readableError(''), 'The step failed.');
  });

  it('schedules timers and signal timeouts as delayed resumes', async () => {
    const timer = fakeTx();
    await settleRun(timer.tx, run, waiting('timer', { until: '2026-01-01T00:00:05.000Z' }), []);
    assert.deepEqual(timer.calls.jobs, [
      {
        runId: 'run-1',
        command: { type: 'resume', suspensionId: '7', payload: null },
        startAfter: '2026-01-01T00:00:05.000Z'
      }
    ]);

    const signal = fakeTx();
    await settleRun(
      signal.tx,
      run,
      waiting('signal', { name: 'ack', key: 'C1', until: '2026-02-01' }),
      []
    );
    assert.equal(signal.calls.saved[0]?.waitKey, 'ack:C1');
    assert.deepEqual(signal.calls.jobs[0]?.command, {
      type: 'resume',
      suspensionId: '7',
      payload: { timedOut: true }
    });
  });

  it('resumes signal waits at once when signals arrived after the ones already seen', async () => {
    const data = { name: 'claim', key: 'C1', until: '2026-02-01', after: 2 };
    const missed = fakeTx({ received: 3 });
    await settleRun(missed.tx, run, waiting('signal', data), []);
    assert.deepEqual(missed.calls.jobs, [
      { runId: 'run-1', command: { type: 'resume', suspensionId: '7', payload: { payload: null } } }
    ]);
    const current = fakeTx({ received: 2 });
    await settleRun(current.tx, run, waiting('signal', data), []);
    assert.deepEqual(current.calls.jobs, [
      {
        runId: 'run-1',
        command: { type: 'resume', suspensionId: '7', payload: { timedOut: true } },
        startAfter: '2026-02-01',
        id: timeout('run-1', '7', '2026-02-01').id
      }
    ]);
  });

  it('queues human tasks from the suspension data', async () => {
    const { tx, calls } = fakeTx();
    await settleRun(
      tx,
      run,
      waiting('task', {
        title: 'Review',
        subject: 'PCR-1 · Jane Doe',
        summary: 'Medicare needs a PCS',
        queue: 'billing',
        instructions: 'Check codes',
        fields: [{ name: 'note', type: 'string' }],
        outcomes: ['approve', 'reject'],
        hints: { reject: 'Sends it back.', other: 7 },
        context: { claim: 'C1' },
        defaults: null,
        prefill: 'current',
        assignee: 'u-9',
        priority: 3,
        due: '2026-12-01T00:00:00.000Z',
        permission: 'claims:approve'
      }),
      []
    );
    assert.deepEqual(calls.tasks[0], {
      agencyId: 't-1',
      runId: 'run-1',
      waitId: '7',
      kind: 'task',
      queue: 'billing',
      title: 'Review',
      subject: 'PCR-1 · Jane Doe',
      summary: 'Medicare needs a PCS',
      instructions: 'Check codes',
      context: { claim: 'C1' },
      fields: [{ name: 'note', type: 'string' }],
      outcomes: ['approve', 'reject'],
      hints: { reject: 'Sends it back.' },
      defaults: null,
      prefill: 'current',
      priority: 3,
      assigneeId: 'u-9',
      dueAt: '2026-12-01T00:00:00.000Z',
      permission: 'claims:approve'
    });
  });

  it('stops the run instead of opening an unrestricted task for an unknown permission', async () => {
    const { tx, calls } = fakeTx();
    await settleRun(
      tx,
      run,
      waiting('task', { title: 'Approve', queue: 'billing', outcomes: ['ok'], permission: 'x:y' }),
      []
    );
    assert.deepEqual(
      calls.tasks.map((t) => [t.kind, t.title, t.instructions.split('\n')[0]]),
      [['fault', 'Could not continue', 'The task needs the permission x:y, which does not exist.']]
    );
  });

  it('spawns child runs or resumes immediately when there is nothing to wait for', async () => {
    const one = fakeTx({ version: 'v-9' });
    await settleRun(
      one.tx,
      run,
      waiting('workflow', { type: 'x.y', version: 2, inputs: { a: 1 } }),
      []
    );
    assert.deepEqual(one.calls.spawned, [[{ a: 1 }]]);
    assert.deepEqual(one.calls.jobs, [
      { runId: 'child-0', command: { type: 'advance' }, group: 'run-1' }
    ]);

    const none = fakeTx({ version: 'v-9' });
    await settleRun(none.tx, run, waiting('workflows', { type: 'x.y', version: 2, items: [] }), []);
    assert.deepEqual(none.calls.jobs[0]?.command, {
      type: 'resume',
      suspensionId: '7',
      payload: { results: [] }
    });

    const missing = fakeTx();
    await settleRun(
      missing.tx,
      run,
      waiting('workflow', { type: 'x.y', version: 2, inputs: {} }),
      []
    );
    assert.deepEqual(missing.calls.jobs[0]?.command, {
      type: 'resume',
      suspensionId: '7',
      payload: { error: 'Workflow x.y@2 is not published' }
    });
    const unmapped = fakeTx();
    await settleRun(
      unmapped.tx,
      run,
      waiting('workflows', { type: 'x.y', version: 2, items: [{}] }),
      []
    );
    assert.deepEqual(unmapped.calls.jobs[0]?.command, {
      type: 'resume',
      suspensionId: '7',
      payload: { results: [{ error: 'Workflow x.y@2 is not published' }] }
    });
    assert.deepEqual(unmapped.calls.spawned, []);
  });

  it('spawns linked children and resumes the parent immediately with their ids', async () => {
    const spawned = fakeTx({ version: 'v-9' });
    await settleRun(
      spawned.tx,
      run,
      waiting('spawn', { type: 'x.y', version: 2, items: [{ a: 1 }, { a: 2 }] }),
      []
    );
    assert.deepEqual(spawned.calls.spawned, [[{ a: 1 }, { a: 2 }]]);
    assert.deepEqual(spawned.calls.jobs, [
      { runId: 'child-0', command: { type: 'advance' }, group: 'run-1' },
      { runId: 'child-1', command: { type: 'advance' }, group: 'run-1' },
      {
        runId: 'run-1',
        command: { type: 'resume', suspensionId: '7', payload: { runIds: ['child-0', 'child-1'] } }
      }
    ]);
    const empty = fakeTx({ version: 'v-9' });
    await settleRun(empty.tx, run, waiting('spawn', { type: 'x.y', version: 2, items: [] }), []);
    assert.deepEqual(empty.calls.jobs[0]?.command, {
      type: 'resume',
      suspensionId: '7',
      payload: { runIds: [] }
    });
  });

  it('starts detached runs and resumes the starter immediately with their id', async () => {
    const started = fakeTx({ version: 'v-9' });
    await settleRun(
      started.tx,
      run,
      waiting('start', { type: 'x.y', version: 2, inputs: { a: 1 } }),
      []
    );
    assert.equal(started.calls.saved[0]?.status, 'suspended');
    assert.deepEqual(started.calls.spawned, [[{ a: 1 }]]);
    assert.deepEqual(started.calls.jobs, [
      { runId: 'detached-1', command: { type: 'advance' } },
      {
        runId: 'run-1',
        command: { type: 'resume', suspensionId: '7', payload: { runId: 'detached-1' } }
      }
    ]);
    const missing = fakeTx();
    await settleRun(missing.tx, run, waiting('start', { type: 'x.y', version: 2 }), []);
    assert.deepEqual(missing.calls.jobs[0]?.command, {
      type: 'resume',
      suspensionId: '7',
      payload: { error: 'Workflow x.y@2 is not published' }
    });
  });

  it('fails runs waiting on unsupported kinds', async () => {
    const { tx, calls } = fakeTx();
    await settleRun(tx, run, waiting('telepathy', null), []);
    assert.equal(calls.saved[0]?.status, 'failed');
    assert.deepEqual(calls.saved[0]?.error, { message: 'Unsupported wait "telepathy"' });
  });
});

describe('notifyParent', () => {
  const done = (id: string, total: number): ChildRun => ({
    id,
    status: 'completed',
    result: { pin: null, outputs: { total } },
    error: null
  });

  it('resumes the parent once every child is terminal, leaving results in the database', async () => {
    const parent: ParentWait = { status: 'suspended', waitId: '7', kind: 'workflows' };
    const { tx, calls } = fakeTx({
      parent,
      children: [
        done('child-a', 1),
        { id: 'child-b', status: 'failed', result: null, error: { message: 'bad' } }
      ]
    });
    const jobs: RunJob[] = [];
    await notifyParent(tx, child, jobs);
    assert.equal(calls.jobs.length, 0);
    assert.deepEqual(jobs, [
      { runId: 'parent-1', command: { type: 'resume', suspensionId: '7', payload: null } }
    ]);
  });

  it('shapes child results for map and single-workflow waits', () => {
    const children: ChildRun[] = [
      done('child-a', 1),
      { id: 'child-b', status: 'failed', result: null, error: { message: 'bad' } },
      { id: 'child-c', status: 'cancelled', result: null, error: null }
    ];
    assert.deepEqual(childrenPayload('workflows', children), {
      results: [
        { runId: 'child-a', pin: null, outputs: { total: 1 } },
        { runId: 'child-b', error: 'bad' },
        { runId: 'child-c', error: 'Cancelled' }
      ]
    });
    assert.deepEqual(childrenPayload('workflow', [done('child-a', 5)]), {
      runId: 'child-a',
      pin: null,
      outputs: { total: 5 }
    });
    assert.equal(childrenPayload('workflow', []), null);
    assert.equal(isChildWait('workflows'), true);
    assert.equal(isChildWait('timer'), false);
  });

  it('waits for unfinished siblings and ignores parents no longer waiting', async () => {
    const pending = fakeTx({
      parent: { status: 'suspended', waitId: '7', kind: 'workflows' },
      children: [done('child-a', 1), { id: 'b', status: 'faulted', result: null, error: null }]
    });
    const none: RunJob[] = [];
    await notifyParent(pending.tx, child, none);
    await notifyParent(
      fakeTx({ parent: { status: 'cancelled', waitId: '7', kind: 'workflow' } }).tx,
      child,
      none
    );
    await notifyParent(fakeTx().tx, run, none);
    assert.deepEqual(none, []);
  });
});

describe('stallRun and cancelRun', () => {
  it('stall on a fault task that can be retried or cancelled, leaving the parent waiting', async () => {
    const { tx, calls } = fakeTx({
      parent: { status: 'suspended', waitId: '7', kind: 'workflow' }
    });
    await stallRun(tx, child, 'bad input', '2026-01-01T00:00:00.000Z');
    assert.equal(calls.saved[0]?.status, 'faulted');
    assert.deepEqual(calls.saved[0]?.error, { message: 'bad input' });
    assert.equal(calls.tasks[0]?.kind, 'fault');
    assert.equal(calls.tasks[0]?.waitId, 'fault:0:2026-01-01T00:00:00.000Z');
    assert.deepEqual(calls.tasks[0]?.outcomes, ['retry', 'cancel']);
    assert.equal(calls.tasks[0]?.instructions, 'Bad input.\n\nRetry once the cause is fixed.');
    assert.deepEqual(calls.jobs, []);
  });

  it('starts draft recovery when an Encounter to Claim run ends early, and only then', async () => {
    const encounter = {
      ...run,
      graphs: [{ id: 'v-1', key: 'billing.encounter-to-claim', version: 1 }]
    };
    const cancelled = fakeTx({ version: 'v-rec', recovered: ['rec-1'] });
    await cancelRun(cancelled.tx, encounter);
    assert.deepEqual(cancelled.calls.recoveries, [['run-1', 'v-rec', 'The run was cancelled']]);
    assert.ok(
      cancelled.calls.jobs.some((j) => j.runId === 'rec-1' && j.command.type === 'advance')
    );
    const failed = fakeTx({ version: 'v-rec' });
    await settleRun(failed.tx, encounter, waiting('nope' as never, {}), []);
    assert.equal(failed.calls.saved[0]?.status, 'failed');
    assert.deepEqual(failed.calls.recoveries, [
      ['run-1', 'v-rec', 'The run failed: Unsupported wait "nope"']
    ]);
    const unpublished = fakeTx();
    await cancelRun(unpublished.tx, encounter);
    assert.deepEqual(unpublished.calls.recoveries, []);
    const other = fakeTx({ version: 'v-rec' });
    await cancelRun(other.tx, run);
    await settleRun(other.tx, encounter, state({ status: 'completed', result: null }), []);
    assert.deepEqual(other.calls.recoveries, []);
  });

  it('cancel open tasks and cascade to active children', async () => {
    const { tx, calls } = fakeTx({ active: ['c1', 'c2'] });
    await cancelRun(tx, run);
    assert.equal(calls.saved[0]?.status, 'cancelled');
    assert.deepEqual(calls.cancelledTasks, ['run-1']);
    assert.deepEqual(
      calls.jobs.map((j) => [j.runId, j.command.type]),
      [
        ['c1', 'cancel'],
        ['c2', 'cancel']
      ]
    );
  });
});
