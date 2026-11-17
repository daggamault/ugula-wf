import { type Db, findScheduledWorkflows, startRun, type TriggeredWorkflow } from '@ugula/db';
import type { RunQueueClient } from '@ugula/run-queue';
import type { SlotBoss } from '../../shared/gated-work.ts';
import { claimScheduleRun, findDueOn } from './queries.ts';

export const SCHEDULE_QUEUE = 'workflow-schedules';

export const SCHEDULE_CRON = '*/15 * * * *';

type ScheduleBoss = Pick<SlotBoss, 'work'> & {
  createQueue: (name: string) => Promise<void>;
  schedule: (name: string, cron: string) => Promise<void>;
};

type StartDeps = { db: Db; boss: RunQueueClient; report: (message: string) => void };

const startIfDue = async (db: Db, boss: RunQueueClient, agencyId: string, w: TriggeredWorkflow) => {
  if (w.trigger.kind !== 'schedule') return;
  const fireOn = await findDueOn(db, agencyId, w.key, w.trigger);
  if (!fireOn) return;
  await db.transaction().execute(async (tx) => {
    if (!(await claimScheduleRun(tx, agencyId, w.key, fireOn))) return;
    await startRun(tx, boss, { agencyId, versionId: w.versionId, inputs: {} });
  });
};

export const startDueSchedules =
  ({ db, boss, report }: StartDeps) =>
  async () => {
    const agencies = await db
      .selectFrom('agencies')
      .select('id')
      .where('is_active', '=', true)
      .orderBy('id')
      .execute();
    const failed: string[] = [];
    for (const { id } of agencies) {
      try {
        for (const w of await findScheduledWorkflows(db, id)) {
          await startIfDue(db, boss, id, w).catch((err: unknown) => {
            failed.push(`${w.key} for agency ${id}`);
            report(`Schedule ${w.key} failed for agency ${id}: ${String(err)}`);
          });
        }
      } catch (err) {
        failed.push(`agency ${id}`);
        report(`Schedules failed for agency ${id}: ${String(err)}`);
      }
    }
    if (failed.length) throw new Error(`Schedules failed: ${failed.join(', ')}`);
  };

type JobDeps = {
  boss: ScheduleBoss;
  start: () => Promise<void>;
};

export const registerScheduleJob = async ({ boss, start }: JobDeps) => {
  await boss.createQueue(SCHEDULE_QUEUE);
  await boss.schedule(SCHEDULE_QUEUE, SCHEDULE_CRON);
  await boss.work(SCHEDULE_QUEUE, { localConcurrency: 1, batchSize: 1 }, () => start());
};
