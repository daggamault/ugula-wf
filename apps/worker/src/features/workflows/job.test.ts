import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { advance, RUN_QUEUE, type RunJob, SWEEP_QUEUE } from '@ugula/jobs';
import type { Job } from 'pg-boss';
import { registerWorkflowJobs, type WorkflowBoss } from './job.ts';
import type { RunStore } from './queries.ts';

describe('registerWorkflowJobs', () => {
  it('creates queues, schedules the sweeper, and routes jobs to the runner', async () => {
    const calls: string[] = [];
    const handlers = new Map<string, (jobs: Job<unknown>[]) => Promise<unknown>>();
    const boss: WorkflowBoss = {
      createQueue: async (name) => {
        calls.push(`queue:${name}`);
      },
      schedule: async (name, cron) => {
        calls.push(`schedule:${name}:${cron}`);
      },
      work: async (name, options, handler) => {
        calls.push(`work:${name}:${options.localConcurrency}`);
        handlers.set(name, handler as (jobs: Job<unknown>[]) => Promise<unknown>);
        return name;
      }
    };
    const processed: RunJob[] = [];
    let swept = 0;
    await registerWorkflowJobs({
      boss,
      runner: { process: async (job) => void processed.push(job) },
      store: { sweep: async () => ++swept } as unknown as RunStore,
      concurrency: 4
    });
    assert.deepEqual(calls, [
      `queue:${RUN_QUEUE}`,
      `queue:${SWEEP_QUEUE}`,
      `schedule:${SWEEP_QUEUE}:* * * * *`,
      `work:${RUN_QUEUE}:4`,
      `work:${SWEEP_QUEUE}:1`
    ]);
    await handlers.get(RUN_QUEUE)?.([{ data: advance('r1') } as Job<unknown>]);
    await handlers.get(SWEEP_QUEUE)?.([]);
    assert.deepEqual(processed, [advance('r1')]);
    assert.equal(swept, 1);
  });
});
