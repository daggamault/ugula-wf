import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import type { RunQueueClient } from '@ugula/run-queue';
import { registerScheduleJobs, SCHEDULE_CRON, SCHEDULES, startDueAgencies } from './job.ts';

const [daily, monthly] = SCHEDULES;
if (!daily || !monthly) throw new Error('No schedules');

describe('SCHEDULES', () => {
  it('watches deadlines daily at 6 and invoices facilities monthly at 7', () => {
    assert.deepEqual(SCHEDULES, [
      {
        queue: 'billing-watch-deadlines',
        workflow: 'billing.watch-deadlines',
        every: 'day',
        hour: 6
      },
      {
        queue: 'billing-invoice-facilities',
        workflow: 'billing.invoice-facilities',
        every: 'month',
        hour: 7
      }
    ]);
  });
});

describe('registerScheduleJobs', () => {
  const register = async (start: (s: (typeof SCHEDULES)[number]) => Promise<void>) => {
    const calls: unknown[][] = [];
    const handlers: (() => Promise<unknown>)[] = [];
    await registerScheduleJobs({
      boss: {
        createQueue: async (name) => void calls.push(['createQueue', name]),
        schedule: async (name, cron) => void calls.push(['schedule', name, cron]),
        work: async (name, options, h) => {
          calls.push(['work', name, options]);
          handlers.push(() => h([]));
          return name;
        }
      },
      start
    });
    return { calls, handlers };
  };

  it('checks each billing schedule every quarter hour, one job at a time', async () => {
    const { calls } = await register(async () => undefined);
    assert.equal(SCHEDULE_CRON, '*/15 * * * *');
    const one = { localConcurrency: 1, batchSize: 1 };
    assert.deepEqual(calls, [
      ['createQueue', 'billing-watch-deadlines'],
      ['schedule', 'billing-watch-deadlines', SCHEDULE_CRON],
      ['work', 'billing-watch-deadlines', one],
      ['createQueue', 'billing-invoice-facilities'],
      ['schedule', 'billing-invoice-facilities', SCHEDULE_CRON],
      ['work', 'billing-invoice-facilities', one]
    ]);
  });

  it('starts the schedule a queue belongs to', async () => {
    const started: unknown[] = [];
    const { handlers } = await register(async (s) => void started.push(s));
    for (const h of handlers) await h();
    assert.deepEqual(started, [daily, monthly]);
  });

  it('lets a failed start fail the job so it retries', async () => {
    const { handlers } = await register(async (s) =>
      Promise.reject(new Error(`${s.workflow} down`))
    );
    await assert.rejects(
      handlers[0] ?? (async () => undefined),
      /^Error: billing.watch-deadlines down$/
    );
    await assert.rejects(
      handlers[1] ?? (async () => undefined),
      /^Error: billing.invoice-facilities down$/
    );
  });
});

type Agency = { id: string; claimed?: boolean; published?: boolean; fails?: boolean };

const agencyDb = (agencies: Agency[]) => {
  const byId = new Map(agencies.map((a) => [a.id, a]));
  return createRecordingDb(({ sql, parameters }) => {
    if (sql.includes('as fire_on')) {
      return agencies.map((a) => ({ id: a.id, fire_on: '2026-11-04' }));
    }
    if (sql.startsWith('insert into "schedule_runs"')) {
      return byId.get(String(parameters[0]))?.claimed ? [] : [{ agency_id: parameters[0] }];
    }
    if (sql.startsWith('insert into "workflow_runs"')) return [{ id: `run-${parameters[0]}` }];
    if (sql.trimStart().startsWith('insert')) return [];
    if (sql.includes('version')) {
      const a = agencies.find((x) => parameters.includes(x.id));
      if (a?.fails) throw new Error('database down');
      return a?.published === false ? [] : [{ id: `v-${a?.id}`, version: 1, key: 'k' }];
    }
    return [];
  });
};

const DUE_SQL = (zone: string) => `
  select a.id, z.period::date::text as fire_on
  from agencies a
  cross join lateral (
    select date_trunc($1, now() at time zone ${zone}) as period,
      now() at time zone ${zone} as local
  ) z
  where a.is_active
    and z.local >= z.period + make_interval(hours => $2::int)
    and not exists (
      select 1 from schedule_runs r
      where r.agency_id = a.id and r.workflow = $3 and r.fire_on = z.period::date
    )
  order by a.id`;

const ZONE = `coalesce((select bp.time_zone from billing_profiles bp where bp.agency_id = "a"."id"), 'UTC')`;

const run = (agencies: Agency[], schedule = daily) => {
  const jobs: unknown[] = [];
  const boss: RunQueueClient = { insert: async (_, batch) => void jobs.push(...batch) };
  const { db, queries } = agencyDb(agencies);
  const reports: string[] = [];
  const result = startDueAgencies({ db, boss, report: (m) => reports.push(m) })(schedule);
  return { result, queries, jobs, reports };
};

const runInserts = (queries: { sql: string; parameters: readonly unknown[] }[]) =>
  queries.filter((q) => q.sql.startsWith('insert into "workflow_runs"')).map((q) => q.parameters);

describe('startDueAgencies', () => {
  it('finds agencies past the schedule hour in their own time zone that have not fired this period', async () => {
    const { result, queries } = run([]);
    await result;
    assert.deepEqual(
      queries.map((q) => [q.sql, q.parameters]),
      [[DUE_SQL(ZONE), ['day', 6, 'billing.watch-deadlines']]]
    );
  });

  it('truncates to the month for a monthly schedule', async () => {
    const { result, queries } = run([], monthly);
    await result;
    assert.deepEqual(queries[0]?.parameters, ['month', 7, 'billing.invoice-facilities']);
  });

  it('claims the fire date once per agency, then starts a run of the published version', async () => {
    const { result, queries, jobs, reports } = run([{ id: 'a1' }]);
    await result;
    const [, claim] = queries;
    assert.deepEqual(
      [claim?.sql, claim?.parameters],
      [
        'insert into "schedule_runs" ("agency_id", "workflow", "fire_on") values ($1, $2, $3) on conflict do nothing returning "agency_id"',
        ['a1', 'billing.watch-deadlines', '2026-11-04']
      ]
    );
    assert.deepEqual(runInserts(queries), [['a1', 'v-a1', 'running', '{}', null]]);
    assert.deepEqual(jobs, [{ data: { runId: 'run-a1', command: { type: 'advance' } } }]);
    assert.deepEqual(reports, []);
  });

  it('skips an agency whose fire date another worker already claimed', async () => {
    const { result, queries, jobs, reports } = run([{ id: 'a1', claimed: true }]);
    await result;
    assert.equal(queries.length, 2);
    assert.deepEqual([runInserts(queries), jobs, reports], [[], [], []]);
  });

  it('reports an agency without a published version and starts nothing for it', async () => {
    const { result, queries, jobs, reports } = run([{ id: 'a1', published: false }]);
    await result;
    assert.deepEqual([runInserts(queries), jobs], [[], []]);
    assert.deepEqual(reports, ['Schedule: billing.watch-deadlines is not published for agency a1']);
  });

  it('handles each due agency on its own', async () => {
    const { result, queries, reports } = run([
      { id: 'a1' },
      { id: 'a2', published: false },
      { id: 'a3', claimed: true },
      { id: 'a4' }
    ]);
    await result;
    assert.deepEqual(
      queries
        .filter((q) => q.sql.startsWith('insert into "schedule_runs"'))
        .map((q) => q.parameters[0]),
      ['a1', 'a2', 'a3', 'a4']
    );
    assert.deepEqual(
      runInserts(queries).map((p) => p[0]),
      ['a1', 'a4']
    );
    assert.deepEqual(reports, ['Schedule: billing.watch-deadlines is not published for agency a2']);
  });

  it('keeps starting other agencies when one fails, then fails the job so it retries', async () => {
    const { result, queries, reports } = run(
      [{ id: 'a1', fails: true }, { id: 'a2' }, { id: 'a3', fails: true }],
      monthly
    );
    await assert.rejects(result, {
      message: 'Schedule billing.invoice-facilities failed for 2 agencies'
    });
    assert.deepEqual(
      runInserts(queries).map((p) => p[0]),
      ['a2']
    );
    assert.deepEqual(reports, [
      'Schedule billing.invoice-facilities failed for agency a1: Error: database down',
      'Schedule billing.invoice-facilities failed for agency a3: Error: database down'
    ]);
  });
});
