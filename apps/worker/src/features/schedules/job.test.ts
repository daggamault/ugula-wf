import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import type { RunQueueClient } from '@ugula/run-queue';
import { registerScheduleJobs, SCHEDULE_CRON, SCHEDULES, startDueAgencies } from './job.ts';

const [daily, monthly] = SCHEDULES;

describe('registerScheduleJobs', () => {
  it('checks each billing schedule every quarter hour and lets a failed start retry', async () => {
    const calls: string[] = [];
    const handlers: (() => Promise<unknown>)[] = [];
    await registerScheduleJobs({
      boss: {
        createQueue: async (name) => void calls.push(`queue:${name}`),
        schedule: async (name, cron) => void calls.push(`schedule:${name}:${cron}`),
        work: async (name, options, h) => {
          calls.push(`work:${name}:${options.localConcurrency}`);
          handlers.push(() => h([]));
          return name;
        }
      },
      start: async (s) => Promise.reject(new Error(`${s.workflow} down`))
    });
    assert.deepEqual(calls, [
      'queue:billing-watch-deadlines',
      `schedule:billing-watch-deadlines:${SCHEDULE_CRON}`,
      'work:billing-watch-deadlines:1',
      'queue:billing-invoice-facilities',
      `schedule:billing-invoice-facilities:${SCHEDULE_CRON}`,
      'work:billing-invoice-facilities:1'
    ]);
    for (const [i, h] of handlers.entries()) {
      await assert.rejects(h, new RegExp(`${SCHEDULES[i]?.workflow} down`));
    }
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
    if (sql.startsWith('insert into "workflow_runs"')) return [{ id: 'run-1' }];
    if (sql.startsWith('insert')) return [];
    if (sql.includes('version')) {
      const a = agencies.find((x) => parameters.includes(x.id));
      if (a?.fails) throw new Error('database down');
      return a?.published === false ? [] : [{ id: `v-${a?.id}`, version: 1, key: 'k' }];
    }
    return [];
  });
};

describe('startDueAgencies', () => {
  it('starts one run per due agency and fire date, once, in the agency time zone', async () => {
    const jobs: unknown[] = [];
    const boss: RunQueueClient = { insert: async (_, batch) => void jobs.push(...batch) };
    const { db, queries } = agencyDb([
      { id: 'a1' },
      { id: 'a2', published: false },
      { id: 'a3', claimed: true }
    ]);
    const reports: string[] = [];
    if (!daily || !monthly) throw new Error('No schedules');
    await startDueAgencies({ db, boss, report: (m) => reports.push(m) })(daily);
    const due = queries[0];
    assert.ok(due?.sql.includes('date_trunc($1, now() at time zone coalesce('));
    assert.ok(due?.sql.includes('make_interval(hours => $'));
    assert.deepEqual(due?.parameters.slice(0, 1), ['day']);
    assert.ok(due?.parameters.includes(6) && due.parameters.includes('billing.watch-deadlines'));
    const claims = queries.filter((q) => q.sql.startsWith('insert into "schedule_runs"'));
    assert.deepEqual(
      claims.map((q) => q.parameters),
      [
        ['a1', 'billing.watch-deadlines', '2026-11-04'],
        ['a2', 'billing.watch-deadlines', '2026-11-04'],
        ['a3', 'billing.watch-deadlines', '2026-11-04']
      ]
    );
    assert.ok(claims[0]?.sql.includes('on conflict do nothing'));
    assert.equal(queries.filter((q) => q.sql.startsWith('insert into "workflow_runs"')).length, 1);
    assert.deepEqual(reports, ['Schedule: billing.watch-deadlines is not published for agency a2']);
  });

  it('keeps starting other agencies when one fails, then fails the job so it retries', async () => {
    const { db, queries } = agencyDb([{ id: 'a1', fails: true }, { id: 'a2' }]);
    const reports: string[] = [];
    if (!monthly) throw new Error('No schedules');
    await assert.rejects(
      () =>
        startDueAgencies({
          db,
          boss: { insert: async () => undefined },
          report: (m) => reports.push(m)
        })(monthly),
      /failed for 1 agencies/
    );
    assert.equal(queries.filter((q) => q.sql.startsWith('insert into "workflow_runs"')).length, 1);
    assert.deepEqual(reports, [
      'Schedule billing.invoice-facilities failed for agency a1: Error: database down'
    ]);
  });
});
