import { RUN_QUEUE, type RunJob, SWEEP_QUEUE } from '@ugula/run-queue';
import { createGatedWork, type SlotBoss } from '../../shared/gated-work.ts';
import type { LoadGate } from '../../shared/load.ts';
import type { RunStore } from './queries.ts';
import type { Runner } from './runner.ts';

export type WorkflowBoss = SlotBoss & {
  createQueue: (name: string, options?: object) => Promise<void>;
  updateQueue: (name: string, options: object) => Promise<void>;
  schedule: (name: string, cron: string) => Promise<void>;
};

export type WorkflowJobDeps = {
  boss: WorkflowBoss;
  runner: Runner;
  store: RunStore;
  concurrency: number;
  gate: LoadGate;
  report: (message: string) => void;
};

export const registerWorkflowJobs = async ({
  boss,
  runner,
  store,
  concurrency,
  gate,
  report
}: WorkflowJobDeps) => {
  await boss.createQueue(RUN_QUEUE, {
    retryLimit: 20,
    retryDelay: 5,
    retryBackoff: true,
    retryDelayMax: 300,
    expireInSeconds: 900,
    notify: true
  });
  await boss.updateQueue(RUN_QUEUE, { notify: true });
  await boss.createQueue(SWEEP_QUEUE);
  await boss.schedule(SWEEP_QUEUE, '* * * * *');
  await createGatedWork<RunJob>({
    boss,
    queue: RUN_QUEUE,
    concurrency,
    gate,
    report,
    handler: async (jobs) => {
      for (const job of jobs) await runner.process(job.data);
    }
  }).start();
  await boss.work(SWEEP_QUEUE, { localConcurrency: 1, batchSize: 1 }, () => store.sweep());
};
