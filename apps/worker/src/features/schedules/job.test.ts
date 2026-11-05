import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import type { RunQueueClient } from '@ugula/run-queue';
import { registerScheduleJobs, SCHEDULES, startForEveryAgency } from './job.ts';

describe('registerScheduleJobs', () => {
  it('schedules each billing workflow once and reports a failed start', async () => {
    const calls: string[] = [];
    const handlers: (() => Promise<unknown>)[] = [];
    const reports: string[] = [];
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
      start: async (workflow) => Promise.reject(new Error(`${workflow} down`)),
      report: (m) => reports.push(m)
    });
    assert.deepEqual(calls, [
      'queue:billing-watch-deadlines',
      'schedule:billing-watch-deadlines:0 6 * * *',
      'work:billing-watch-deadlines:1',
      'queue:billing-invoice-facilities',
      'schedule:billing-invoice-facilities:0 7 1 * *',
      'work:billing-invoice-facilities:1'
    ]);
    for (const h of handlers) await h();
    assert.deepEqual(
      reports,
      SCHEDULES.map((s) => `Schedule ${s.workflow} failed: Error: ${s.workflow} down`)
    );
  });
});

describe('startForEveryAgency', () => {
  it('starts one run per active agency that has the workflow published', async () => {
    const jobs: unknown[] = [];
    const boss: RunQueueClient = { insert: async (_, batch) => void jobs.push(...batch) };
    const { db, queries } = createRecordingDb(({ sql, parameters }) => {
      if (sql.startsWith('select "id" from "agencies"')) return [{ id: 'a1' }, { id: 'a2' }];
      if (sql.includes('max(') || sql.includes('version'))
        return parameters.includes('a1')
          ? [{ id: 'v1', version: 1, key: 'billing.watch-deadlines' }]
          : [];
      if (sql.startsWith('insert into "workflow_runs"')) return [{ id: 'run-1' }];
      return [];
    });
    const reports: string[] = [];
    await startForEveryAgency({ db, boss, report: (m) => reports.push(m) })(
      'billing.watch-deadlines'
    );
    assert.ok(queries.some((q) => q.sql.startsWith('insert into "workflow_runs"')));
    assert.deepEqual(reports, ['Schedule: billing.watch-deadlines is not published for agency a2']);
  });
});
