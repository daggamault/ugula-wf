import { agencyTimeZone, type Db, resolveWorkflowVersion, startRun } from '@ugula/db';
import type { RunQueueClient } from '@ugula/run-queue';
import { sql } from 'kysely';
import type { SlotBoss } from '../../shared/gated-work.ts';

type Schedule = {
  queue: string;
  workflow: string;
  every: 'day' | 'month';
  hour: number;
};

export const SCHEDULES: readonly Schedule[] = [
  { queue: 'billing-watch-deadlines', workflow: 'billing.watch-deadlines', every: 'day', hour: 6 },
  {
    queue: 'billing-invoice-facilities',
    workflow: 'billing.invoice-facilities',
    every: 'month',
    hour: 7
  }
];

export const SCHEDULE_CRON = '*/15 * * * *';

type ScheduleBoss = Pick<SlotBoss, 'work'> & {
  createQueue: (name: string) => Promise<void>;
  schedule: (name: string, cron: string) => Promise<void>;
};

type StartDeps = { db: Db; boss: RunQueueClient; report: (message: string) => void };

type DueAgency = { id: string; fire_on: string };

const findDueAgencies = (db: Db, s: Schedule) =>
  sql<DueAgency>`
  select a.id, z.period::date::text as fire_on
  from agencies a
  cross join lateral (
    select date_trunc(${s.every}, now() at time zone ${agencyTimeZone(sql.ref('a.id'))}) as period,
      now() at time zone ${agencyTimeZone(sql.ref('a.id'))} as local
  ) z
  where a.is_active
    and z.local >= z.period + make_interval(hours => ${s.hour}::int)
    and not exists (
      select 1 from schedule_runs r
      where r.agency_id = a.id and r.workflow = ${s.workflow} and r.fire_on = z.period::date
    )
  order by a.id`.execute(db);

const startOnce = (db: Db, boss: RunQueueClient, s: Schedule, due: DueAgency) =>
  db.transaction().execute(async (tx) => {
    const claimed = await tx
      .insertInto('schedule_runs')
      .values({ agency_id: due.id, workflow: s.workflow, fire_on: due.fire_on })
      .onConflict((oc) => oc.doNothing())
      .returning('agency_id')
      .executeTakeFirst();
    if (!claimed) return 'claimed';
    const version = await resolveWorkflowVersion(tx, due.id, s.workflow);
    if (!version) return 'unpublished';
    await startRun(tx, boss, { agencyId: due.id, versionId: version.id, inputs: {} });
    return 'started';
  });

export const startDueAgencies =
  ({ db, boss, report }: StartDeps) =>
  async (s: Schedule) => {
    const { rows } = await findDueAgencies(db, s);
    const failed: string[] = [];
    for (const due of rows) {
      try {
        if ((await startOnce(db, boss, s, due)) === 'unpublished') {
          report(`Schedule: ${s.workflow} is not published for agency ${due.id}`);
        }
      } catch (err) {
        failed.push(due.id);
        report(`Schedule ${s.workflow} failed for agency ${due.id}: ${String(err)}`);
      }
    }
    if (failed.length) {
      throw new Error(`Schedule ${s.workflow} failed for ${failed.length} agencies`);
    }
  };

type JobDeps = {
  boss: ScheduleBoss;
  start: (s: Schedule) => Promise<void>;
};

export const registerScheduleJobs = async ({ boss, start }: JobDeps) => {
  for (const s of SCHEDULES) {
    await boss.createQueue(s.queue);
    await boss.schedule(s.queue, SCHEDULE_CRON);
    await boss.work(s.queue, { localConcurrency: 1, batchSize: 1 }, () => start(s));
  }
};
