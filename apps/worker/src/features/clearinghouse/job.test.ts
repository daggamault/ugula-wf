import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { POLL_QUEUE, registerPollJob } from './job.ts';

describe('registerPollJob', () => {
  it('schedules one poller at a time and reports a failed poll', async () => {
    const calls: string[] = [];
    let handler: (() => Promise<unknown>) | undefined;
    const reports: string[] = [];
    await registerPollJob({
      boss: {
        createQueue: async (name) => void calls.push(`queue:${name}`),
        schedule: async (name, cron) => void calls.push(`schedule:${name}:${cron}`),
        work: async (name, options, h) => {
          calls.push(`work:${name}:${options.localConcurrency}:${options.batchSize}`);
          handler = () => h([]);
          return 'poller';
        }
      },
      poll: async () => Promise.reject(new Error('sftp down')),
      pollMinutes: 5,
      report: (m) => reports.push(m)
    });
    assert.deepEqual(calls, [
      `queue:${POLL_QUEUE}`,
      `schedule:${POLL_QUEUE}:*/5 * * * *`,
      `work:${POLL_QUEUE}:1:1`
    ]);
    await handler?.();
    assert.deepEqual(reports, ['Clearinghouse poll failed: Error: sftp down']);
  });
});
