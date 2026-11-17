import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { POLL_QUEUE, registerPollJob } from './job.ts';

const register = async (poll: () => Promise<void>, pollMinutes = 5) => {
  const calls: unknown[][] = [];
  const reports: string[] = [];
  let handler: (() => Promise<unknown>) | undefined;
  await registerPollJob({
    boss: {
      createQueue: async (name) => void calls.push(['createQueue', name]),
      schedule: async (name, cron) => void calls.push(['schedule', name, cron]),
      work: async (name, options, h) => {
        calls.push(['work', name, options]);
        handler = () => h([]);
        return 'poller';
      }
    },
    poll,
    pollMinutes,
    report: (m) => reports.push(m)
  });
  return { calls, reports, run: () => handler?.() };
};

describe('registerPollJob', () => {
  it('creates the queue, schedules it every pollMinutes and works one job at a time', async () => {
    const { calls } = await register(async () => undefined, 5);
    assert.deepEqual(calls, [
      ['createQueue', POLL_QUEUE],
      ['schedule', POLL_QUEUE, '*/5 * * * *'],
      ['work', POLL_QUEUE, { localConcurrency: 1, batchSize: 1 }]
    ]);
  });

  it('polls once per job and reports nothing when the poll succeeds', async () => {
    let polls = 0;
    const { reports, run } = await register(async () => void polls++);
    assert.equal(await run(), undefined);
    assert.deepEqual([polls, reports], [1, []]);
  });

  it('reports a failed poll instead of failing the job', async () => {
    const { reports, run } = await register(async () => Promise.reject(new Error('sftp down')));
    assert.equal(await run(), undefined);
    assert.deepEqual(reports, ['Clearinghouse poll failed: Error: sftp down']);
  });
});
