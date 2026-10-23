import { RUN_QUEUE, type RunJob, SWEEP_QUEUE } from '@ugula/jobs';
import type { Job } from 'pg-boss';
import type { RunStore } from './queries.ts';
import type { Runner } from './runner.ts';

export type WorkflowBoss = {
  createQueue: (name: string, options?: object) => Promise<void>;
  schedule: (name: string, cron: string) => Promise<void>;
  work: <T>(
    name: string,
    options: { localConcurrency: number; batchSize: number },
    handler: (jobs: Job<T>[]) => Promise<unknown>
  ) => Promise<string>;
};

export type WorkflowJobDeps = {
  boss: WorkflowBoss;
  runner: Runner;
  store: RunStore;
  concurrency: number;
};

export const registerWorkflowJobs = async ({
  boss,
  runner,
  store,
  concurrency
}: WorkflowJobDeps) => {
  await boss.createQueue(RUN_QUEUE, {
    retryLimit: 20,
    retryDelay: 5,
    retryBackoff: true,
    retryDelayMax: 300,
    expireInSeconds: 900
  });
  await boss.createQueue(SWEEP_QUEUE);
  await boss.schedule(SWEEP_QUEUE, '* * * * *');
  await boss.work<RunJob>(
    RUN_QUEUE,
    { localConcurrency: concurrency, batchSize: 1 },
    async (jobs) => {
      for (const job of jobs) await runner.process(job.data);
    }
  );
  await boss.work(SWEEP_QUEUE, { localConcurrency: 1, batchSize: 1 }, () => store.sweep());
};
