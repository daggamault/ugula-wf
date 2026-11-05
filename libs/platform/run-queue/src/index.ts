import { createHash } from 'node:crypto';

export const RUN_QUEUE = 'workflow-run';
export const SWEEP_QUEUE = 'workflow-sweep';
export const PRUNE_QUEUE = 'workflow-prune';

export type RunCommand =
  | { type: 'advance' }
  | { type: 'resume'; suspensionId: string; payload: unknown }
  | { type: 'retry' }
  | { type: 'skip'; pin: string | null; outputs: Record<string, unknown> }
  | { type: 'cancel' };

export type RunJob = {
  runId: string;
  command: RunCommand;
  startAfter?: string;
  group?: string;
  id?: string;
  interactive?: boolean;
};

export type SqlExecutor = {
  executeSql: (text: string, values?: unknown[]) => Promise<{ rows: unknown[] }>;
};

export type RunQueueClient = {
  insert: (
    name: string,
    jobs: {
      data: object;
      id?: string;
      startAfter?: string;
      retryLimit?: number;
      priority?: number;
      group?: { id: string };
    }[],
    options: { db: SqlExecutor }
  ) => Promise<unknown>;
};

export type TimeoutClient = {
  deleteJob: (name: string, id: string, options: { db: SqlExecutor }) => Promise<unknown>;
};

const DURABLE_RETRY_LIMIT = 1_000_000;

const INTERACTIVE_PRIORITY = 2;

const DEFERRED_PRIORITY = 1;

export const advance = (runId: string, group?: string | null): RunJob => ({
  runId,
  command: { type: 'advance' },
  ...(group ? { group } : {})
});

export const start = (runId: string): RunJob => ({ ...advance(runId), interactive: true });

export const resume = (
  runId: string,
  suspensionId: string,
  payload: unknown,
  startAfter?: string
): RunJob => ({
  runId,
  command: { type: 'resume', suspensionId, payload },
  ...(startAfter ? { startAfter } : {})
});

const timeoutJobId = (runId: string, waitId: string) => {
  const h = createHash('sha256').update(`timeout:${runId}:${waitId}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

export const timeout = (runId: string, waitId: string, until: string): RunJob => ({
  ...resume(runId, waitId, { timedOut: true }, until),
  id: timeoutJobId(runId, waitId)
});

export const dropTimeout = async (
  boss: TimeoutClient,
  db: SqlExecutor,
  runId: string,
  waitId: string
) => {
  await boss.deleteJob(RUN_QUEUE, timeoutJobId(runId, waitId), { db });
};

const priorityOf = ({ command, startAfter, interactive }: RunJob) =>
  interactive
    ? INTERACTIVE_PRIORITY
    : command.type === 'advance'
      ? 0
      : startAfter
        ? DEFERRED_PRIORITY
        : INTERACTIVE_PRIORITY;

export const retry = (runId: string): RunJob => ({ runId, command: { type: 'retry' } });

export const skip = (
  runId: string,
  pin: string | null,
  outputs: Record<string, unknown>
): RunJob => ({
  runId,
  command: { type: 'skip', pin, outputs }
});

export const cancel = (runId: string): RunJob => ({ runId, command: { type: 'cancel' } });

export const enqueueRuns = async (boss: RunQueueClient, db: SqlExecutor, jobs: RunJob[]) => {
  if (!jobs.length) return;
  await boss.insert(
    RUN_QUEUE,
    jobs.map((job) => {
      const { runId, command, startAfter, group, id } = job;
      const priority = priorityOf(job);
      return {
        data: { runId, command },
        ...(id ? { id } : {}),
        ...(startAfter ? { startAfter } : {}),
        ...(command.type === 'advance' ? {} : { retryLimit: DURABLE_RETRY_LIMIT }),
        ...(priority ? { priority } : {}),
        ...(group ? { group: { id: group } } : {})
      };
    }),
    { db }
  );
};
