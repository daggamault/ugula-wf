import { type Db, sqlExecutor } from '@ugula/db';
import { checkField, type FieldSpec, isRecord, type Json } from '@ugula/graph';
import type { LiveEvent } from '@ugula/live';
import {
  cancel,
  enqueueRuns,
  type RunJob,
  type RunQueueClient,
  resume,
  retry,
  skip
} from '@ugula/run-queue';
import { type Announce, announced } from '../../shared/live.ts';
import { fail, ok } from '../../shared/result.ts';
import {
  assignTask,
  claimNext,
  completeTask,
  findTask,
  findTaskSource,
  listQueues
} from './queries.ts';

type TaskServiceDeps = {
  db: Db;
  boss: RunQueueClient;
  announce: Announce;
};

type Completion = {
  outcome: string;
  values: Record<string, Json>;
};

const notFound = fail('not_found', 'Task not found');
const closed = fail('conflict', 'Task is already closed');
const taken = fail('conflict', 'Another user is working this task');

const blocked = (
  task: { status: string; assignee_id: string | null } | undefined,
  userId: string
) =>
  !task
    ? notFound
    : task.status !== 'open'
      ? closed
      : task.assignee_id !== null && task.assignee_id !== userId
        ? taken
        : null;

export const fieldErrors = (fields: unknown, values: Record<string, Json>, outcome: string) =>
  Object.fromEntries(
    (Array.isArray(fields) ? (fields as FieldSpec[]) : []).flatMap((f) => {
      const err = checkField(f, values[f.name] ?? null, outcome);
      return err ? [[f.name, err]] : [];
    })
  );

export const jobFor = (
  task: { kind: string; run_id: string; wait_id: string },
  userId: string,
  { outcome, values }: Completion
): RunJob => {
  if (task.kind === 'task') return resume(task.run_id, task.wait_id, { outcome, values, userId });
  if (outcome === 'retry') return retry(task.run_id);
  if (outcome === 'skip') {
    return skip(
      task.run_id,
      typeof values.pin === 'string' ? values.pin : null,
      isRecord(values.outputs) ? values.outputs : {}
    );
  }
  return cancel(task.run_id);
};

export const createTaskService = ({ db, boss, announce }: TaskServiceDeps) => {
  const changed = (id: string): LiveEvent[] => [{ kind: 'task', id, runId: null }];

  const reassign = async (tenantId: string, id: string, userId: string, assignee: string | null) =>
    (await assignTask(db, { tenantId, id, userId, assignee }))
      ? ok({ status: assignee ? 'claimed' : 'released' })
      : (blocked(await findTask(db, tenantId, id), userId) ?? closed);

  const assign = (tenantId: string, id: string, userId: string, assignee: string | null) =>
    announced(announce, tenantId, reassign(tenantId, id, userId, assignee), () => changed(id));

  return {
    queues: async (tenantId: string, userId: string) =>
      ok({ queues: await listQueues(db, tenantId, userId) }),

    find: async (tenantId: string, id: string) => {
      const task = await findTask(db, tenantId, id);
      if (!task) return notFound;
      const source = await findTaskSource(db, task.run_id);
      const claim =
        source?.claim_id && source.claim_number !== null && source.claim_status
          ? {
              id: source.claim_id,
              number: source.claim_number,
              status: source.claim_status,
              patient: source.last_name ? `${source.last_name}, ${source.first_name}` : null
            }
          : null;
      return ok({
        task: {
          ...task,
          source: {
            reportId: source?.report_id ?? null,
            pcrNumber: source?.pcr_number ?? null,
            claim
          }
        }
      });
    },

    next: (tenantId: string, queue: string | null, userId: string) =>
      announced(
        announce,
        tenantId,
        claimNext(db, tenantId, queue, userId).then((task) => ok({ task: task ?? null })),
        ({ task }) => (task ? changed(task.id) : [])
      ),

    claim: (tenantId: string, id: string, userId: string) => assign(tenantId, id, userId, userId),

    release: (tenantId: string, id: string, userId: string) => assign(tenantId, id, userId, null),

    complete: (tenantId: string, userId: string, id: string, completion: Completion) =>
      announced(
        announce,
        tenantId,
        db.transaction().execute(async (tx) => {
          const task = await findTask(tx, tenantId, id);
          if (!task) return notFound;
          const refused = blocked(task, userId);
          if (refused) return refused;
          if (!task.outcomes.includes(completion.outcome)) {
            return fail('invalid', `Unknown outcome "${completion.outcome}"`);
          }
          const checked = task.kind === 'task' || completion.outcome === 'skip';
          const fields = checked
            ? fieldErrors(task.fields, completion.values, completion.outcome)
            : {};
          if (Object.keys(fields).length) {
            return fail('invalid', 'Some fields are invalid', { fields });
          }
          if (!(await completeTask(tx, { tenantId, id, userId, resolution: completion }))) {
            return blocked(await findTask(tx, tenantId, id), userId) ?? closed;
          }
          await enqueueRuns(boss, sqlExecutor(tx), [jobFor(task, userId, completion)]);
          return ok({ status: 'completed' });
        }),
        () => changed(id)
      )
  };
};

export type TaskService = ReturnType<typeof createTaskService>;
