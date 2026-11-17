import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import type { RunQueueClient } from '@ugula/run-queue';
import { registerScheduleJob, SCHEDULE_CRON, SCHEDULE_QUEUE, startDueSchedules } from './job.ts';

describe('registerScheduleJob', () => {
  const register = async (start: () => Promise<void>) => {
    const calls: unknown[][] = [];
    const handlers: (() => Promise<unknown>)[] = [];
    await registerScheduleJob({
      boss: {
        createQueue: async (name: string) => void calls.push(['createQueue', name]),
        schedule: async (name: string, cron: string) => void calls.push(['schedule', name, cron]),
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

  it('checks every scheduled workflow every quarter hour, one job at a time', async () => {
    const { calls } = await register(async () => undefined);
    assert.equal(SCHEDULE_CRON, '*/15 * * * *');
    assert.deepEqual(calls, [
      ['createQueue', SCHEDULE_QUEUE],
      ['schedule', SCHEDULE_QUEUE, SCHEDULE_CRON],
      ['work', SCHEDULE_QUEUE, { localConcurrency: 1, batchSize: 1 }]
    ]);
  });

  it('lets a failed start fail the job so it retries', async () => {
    const { handlers } = await register(async () => Promise.reject(new Error('down')));
    await assert.rejects(handlers[0] ?? (async () => undefined), /^Error: down$/);
  });
});

type Workflow = { key: string; every: string; hour: number; due?: boolean; claimed?: boolean };

type Agency = { id: string; workflows: Workflow[]; fails?: boolean };

const scheduleDb = (agencies: Agency[]) => {
  const byKey = (agencyId: unknown, key: unknown) =>
    agencies.find((a) => a.id === agencyId)?.workflows.find((w) => w.key === key);
  return createRecordingDb(({ sql, parameters }) => {
    if (sql.startsWith('select "id" from "agencies"')) return agencies.map((a) => ({ id: a.id }));
    if (sql.includes('v.id as version_id')) {
      const agency = agencies.find((a) => parameters.includes(a.id));
      if (agency?.fails) throw new Error('database down');
      return (agency?.workflows ?? []).map((w) => ({
        key: w.key,
        version_id: `v-${agency?.id}-${w.key}`,
        trigger: { kind: 'schedule', every: w.every, hour: w.hour },
        signature: { execIn: ['exec'], execOut: [], inputs: [], outputs: [] }
      }));
    }
    if (sql.includes('as fire_on')) {
      const w = byKey(parameters.at(-2), parameters.at(-1));
      return w?.due === false ? [] : [{ fire_on: '2026-11-04' }];
    }
    if (sql.startsWith('insert into "schedule_runs"')) {
      return byKey(parameters[0], parameters[1])?.claimed ? [] : [{ agency_id: parameters[0] }];
    }
    if (sql.startsWith('insert into "workflow_runs"')) return [{ id: `run-${parameters[1]}` }];
    return [];
  });
};

const run = (agencies: Agency[]) => {
  const jobs: unknown[] = [];
  const boss: RunQueueClient = { insert: async (_, batch) => void jobs.push(...batch) };
  const { db, queries } = scheduleDb(agencies);
  const reports: string[] = [];
  const result = startDueSchedules({ db, boss, report: (m) => reports.push(m) })();
  return { result, queries, jobs, reports };
};

const started = (queries: { sql: string; parameters: readonly unknown[] }[]) =>
  queries
    .filter((q) => q.sql.startsWith('insert into "workflow_runs"'))
    .map((q) => q.parameters[1]);

const DEADLINES = { key: 'billing.watch-deadlines', every: 'day', hour: 6 };

const INVOICES = { key: 'billing.invoice-facilities', every: 'month', hour: 7 };

describe('startDueSchedules', () => {
  it('asks when each scheduled workflow of each active agency is due, in its own time zone', async () => {
    const { result, queries } = run([{ id: 'a1', workflows: [DEADLINES, INVOICES] }]);
    await result;
    const due = queries.filter((q) => q.sql.includes('as fire_on'));
    assert.deepEqual(
      due.map((q) => q.parameters),
      [
        ['day', 'a1', 'a1', 6, 'a1', 'billing.watch-deadlines'],
        ['month', 'a1', 'a1', 7, 'a1', 'billing.invoice-facilities']
      ]
    );
    assert.match(due[0]?.sql ?? '', /date_trunc\(\$1, now\(\) at time zone coalesce\(/);
  });

  it('claims the fire date once, then starts the published version with no inputs', async () => {
    const { result, queries, jobs, reports } = run([{ id: 'a1', workflows: [DEADLINES] }]);
    await result;
    const claim = queries.find((q) => q.sql.startsWith('insert into "schedule_runs"'));
    assert.deepEqual(claim?.parameters, ['a1', 'billing.watch-deadlines', '2026-11-04']);
    assert.deepEqual(started(queries), ['v-a1-billing.watch-deadlines']);
    assert.equal(
      queries.find((q) => q.sql.startsWith('insert into "workflow_runs"'))?.parameters[3],
      '{}'
    );
    assert.equal(jobs.length, 1);
    assert.deepEqual(reports, []);
  });

  it('starts nothing that is not due yet or that another worker already claimed', async () => {
    const { result, queries, jobs } = run([
      {
        id: 'a1',
        workflows: [
          { ...DEADLINES, due: false },
          { ...INVOICES, claimed: true }
        ]
      }
    ]);
    await result;
    assert.deepEqual([started(queries), jobs], [[], []]);
  });

  it('handles each agency on its own and fails the job after reporting the others', async () => {
    const { result, queries, reports } = run([
      { id: 'a1', workflows: [DEADLINES] },
      { id: 'a2', workflows: [DEADLINES], fails: true },
      { id: 'a3', workflows: [INVOICES] }
    ]);
    await assert.rejects(result, /^Error: Schedules failed: agency a2$/);
    assert.deepEqual(started(queries), [
      'v-a1-billing.watch-deadlines',
      'v-a3-billing.invoice-facilities'
    ]);
    assert.deepEqual(reports, ['Schedules failed for agency a2: Error: database down']);
  });
});
