import { type Db, resolveWorkflowVersion, startRun } from '@ugula/db';
import type { RunQueueClient } from '@ugula/run-queue';
import type { SlotBoss } from '../../shared/gated-work.ts';

export const SCHEDULES = [
  { queue: 'billing-watch-deadlines', cron: '0 6 * * *', workflow: 'billing.watch-deadlines' },
  { queue: 'billing-invoice-facilities', cron: '0 7 1 * *', workflow: 'billing.invoice-facilities' }
] as const;

type ScheduleBoss = Pick<SlotBoss, 'work'> & {
  createQueue: (name: string) => Promise<void>;
  schedule: (name: string, cron: string) => Promise<void>;
};

type StartDeps = { db: Db; boss: RunQueueClient; report: (message: string) => void };

export const startForEveryAgency =
  ({ db, boss, report }: StartDeps) =>
  async (workflow: string) => {
    const agencies = await db
      .selectFrom('agencies')
      .select('id')
      .where('is_active', '=', true)
      .orderBy('id')
      .execute();
    for (const { id } of agencies) {
      const version = await resolveWorkflowVersion(db, id, workflow);
      if (!version) {
        report(`Schedule: ${workflow} is not published for agency ${id}`);
        continue;
      }
      await db
        .transaction()
        .execute((tx) => startRun(tx, boss, { agencyId: id, versionId: version.id, inputs: {} }));
    }
  };

type JobDeps = {
  boss: ScheduleBoss;
  start: (workflow: string) => Promise<void>;
  report: (message: string) => void;
};

export const registerScheduleJobs = async ({ boss, start, report }: JobDeps) => {
  for (const { queue, cron, workflow } of SCHEDULES) {
    await boss.createQueue(queue);
    await boss.schedule(queue, cron);
    await boss.work(queue, { localConcurrency: 1, batchSize: 1 }, async () => {
      await start(workflow).catch((err: unknown) =>
        report(`Schedule ${workflow} failed: ${String(err)}`)
      );
    });
  }
};
