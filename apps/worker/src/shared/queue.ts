import type { WorkHandler } from 'pg-boss';

export type QueueBoss = {
  createQueue: (name: string) => Promise<void>;
  work: <ReqData>(name: string, handler: WorkHandler<ReqData>) => Promise<string>;
};

export const registerQueue = async <ReqData>(
  boss: QueueBoss,
  name: string,
  handler: WorkHandler<ReqData>
) => {
  await boss.createQueue(name);
  return boss.work(name, handler);
};
