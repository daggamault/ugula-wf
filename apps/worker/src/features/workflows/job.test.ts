import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { advance, PRUNE_QUEUE, RUN_QUEUE, type RunJob, SWEEP_QUEUE } from '@ugula/run-queue';
import type { Job } from 'pg-boss';
import type { LoadGate } from '../../shared/load.ts';
import { registerWorkflowJobs, type WorkflowBoss } from './job.ts';
import type { RunStore } from './run-store.ts';

const setup = async ({
  gate = () => ({ open: true, reason: null }),
  process = async () => undefined
}: {
  gate?: LoadGate;
  process?: (job: RunJob) => Promise<void>;
} = {}) => {
  const calls: unknown[][] = [];
  const handlers = new Map<string, (jobs: Job<unknown>[]) => Promise<unknown>>();
  const boss: WorkflowBoss = {
    createQueue: async (name, options) =>
      void calls.push(options ? ['createQueue', name, options] : ['createQueue', name]),
    updateQueue: async (name, options) => void calls.push(['updateQueue', name, options]),
    schedule: async (name, cron) => void calls.push(['schedule', name, cron]),
    work: async (name, options, handler) => {
      calls.push(['work', name, options]);
      handlers.set(name, handler as (jobs: Job<unknown>[]) => Promise<unknown>);
      return `${name}:${calls.length}`;
    },
    offWork: async (name, options) => void calls.push(['offWork', name, options])
  };
  const counts = { swept: 0, pruned: 0 };
  const reports: string[] = [];
  const jobs = await registerWorkflowJobs({
    boss,
    runner: { process },
    store: {
      sweep: async () => ++counts.swept,
      prune: async () => ++counts.pruned
    } as unknown as RunStore,
    concurrency: 2,
    gate,
    report: (m) => reports.push(m)
  });
  jobs.stop();
  return { calls, handlers, counts, reports };
};

describe('registerWorkflowJobs', () => {
  it('creates the run queue with retries, backoff and notify, and turns notify on for an existing queue', async () => {
    const { calls } = await setup();
    assert.deepEqual(calls.slice(0, 2), [
      [
        'createQueue',
        RUN_QUEUE,
        {
          retryLimit: 20,
          retryDelay: 5,
          retryBackoff: true,
          retryDelayMax: 300,
          expireInSeconds: 900,
          notify: true
        }
      ],
      ['updateQueue', RUN_QUEUE, { notify: true }]
    ]);
  });

  it('sweeps every minute and prunes hourly, one job at a time', async () => {
    const { calls } = await setup();
    const one = { localConcurrency: 1, batchSize: 1 };
    assert.deepEqual(calls.slice(2), [
      ['createQueue', SWEEP_QUEUE],
      ['schedule', SWEEP_QUEUE, '* * * * *'],
      ['createQueue', PRUNE_QUEUE],
      ['schedule', PRUNE_QUEUE, '17 * * * *'],
      ['work', RUN_QUEUE, { localConcurrency: 1, batchSize: 1, groupConcurrency: 2 }],
      ['work', RUN_QUEUE, { localConcurrency: 1, batchSize: 1, groupConcurrency: 2 }],
      ['work', SWEEP_QUEUE, one],
      ['work', PRUNE_QUEUE, one]
    ]);
  });

  it('opens no run slots while the load gate is closed', async () => {
    const { calls, handlers, reports } = await setup({
      gate: () => ({ open: false, reason: 'the heap is full' })
    });
    assert.deepEqual(
      calls.filter(([kind, name]) => kind === 'work' && name === RUN_QUEUE),
      []
    );
    assert.equal(handlers.has(RUN_QUEUE), false);
    assert.deepEqual(reports, [`Not taking ${RUN_QUEUE} jobs while the heap is full`]);
  });

  it('hands every job of a batch to the runner in order', async () => {
    const processed: RunJob[] = [];
    const { handlers } = await setup({ process: async (job) => void processed.push(job) });
    await handlers.get(RUN_QUEUE)?.([
      { data: advance('r1') } as Job<unknown>,
      { data: advance('r2') } as Job<unknown>
    ]);
    assert.deepEqual(processed, [advance('r1'), advance('r2')]);
  });

  it('fails the run job when the runner throws so pg-boss retries it', async () => {
    const { handlers } = await setup({
      process: async () => Promise.reject(new Error('lost the lease'))
    });
    await assert.rejects(
      async () => handlers.get(RUN_QUEUE)?.([{ data: advance('r1') } as Job<unknown>]),
      { message: 'lost the lease' }
    );
  });

  it('routes sweep and prune jobs to the store', async () => {
    const { handlers, counts } = await setup();
    await handlers.get(SWEEP_QUEUE)?.([]);
    await handlers.get(PRUNE_QUEUE)?.([]);
    await handlers.get(PRUNE_QUEUE)?.([]);
    assert.deepEqual(counts, { swept: 1, pruned: 2 });
  });
});
