import { type QueueBoss, registerQueue } from '../../shared/queue.ts';

export const HEALTH_QUEUE = 'health';

export const registerHealthJob = (boss: QueueBoss) =>
  registerQueue(boss, HEALTH_QUEUE, async () => ({ status: 'ok' }));
