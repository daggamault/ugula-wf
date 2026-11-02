export const RUN_QUEUE = 'workflow-run';
export const SWEEP_QUEUE = 'workflow-sweep';

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
};

export type SqlExecutor = {
  executeSql: (text: string, values?: unknown[]) => Promise<{ rows: unknown[] }>;
};

export type RunQueueClient = {
  insert: (
    name: string,
    jobs: { data: object; startAfter?: string }[],
    options: { db: SqlExecutor }
  ) => Promise<unknown>;
};

export const advance = (runId: string): RunJob => ({ runId, command: { type: 'advance' } });

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
    jobs.map(({ runId, command, startAfter }) => ({
      data: { runId, command },
      ...(startAfter ? { startAfter } : {})
    })),
    { db }
  );
};
