import type { SlotBoss } from '../../shared/gated-work.ts';

export const POLL_QUEUE = 'clearinghouse-poll';

type PollBoss = Pick<SlotBoss, 'work'> & {
  createQueue: (name: string) => Promise<void>;
  schedule: (name: string, cron: string) => Promise<void>;
};

type PollJobDeps = {
  boss: PollBoss;
  poll: () => Promise<void>;
  pollMinutes: number;
  report: (message: string) => void;
};

export const registerPollJob = async ({ boss, poll, pollMinutes, report }: PollJobDeps) => {
  await boss.createQueue(POLL_QUEUE);
  await boss.schedule(POLL_QUEUE, `*/${pollMinutes} * * * *`);
  await boss.work(POLL_QUEUE, { localConcurrency: 1, batchSize: 1 }, async () => {
    await poll().catch((err: unknown) => report(`Clearinghouse poll failed: ${String(err)}`));
  });
};
