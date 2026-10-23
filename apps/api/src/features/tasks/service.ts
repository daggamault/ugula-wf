import { type Db, sqlExecutor } from '@ugula/db';
import { checkField, type FieldSpec, isRecord, type Json } from '@ugula/graph';
import { cancel, enqueueRuns, type JobBoss, type RunJob, resume, retry, skip } from '@ugula/jobs';
import { fail, ok } from '../../shared/result.ts';
import {
  assignTask,
  claimNext,
  completeTask,
  findTask,
  listQueues,
  listTasks,
  type TaskFilters
} from './queries.ts';

export type TaskServiceDeps = {
  db: Db;
  boss: JobBoss;
};

export type Completion = {
  outcome: string;
  values: Record<string, Json>;
};

const notFound = fail('not_found', 'Task not found');
const closed = fail('conflict', 'Task is already closed');

export const fieldErrors = (fields: unknown, values: Record<string, Json>) =>
  Object.fromEntries(
    (Array.isArray(fields) ? (fields as FieldSpec[]) : []).flatMap((f) => {
      const err = checkField(f, values[f.name] ?? null);
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

export const createTaskService = ({ db, boss }: TaskServiceDeps) => {
  const assign = async (tenantId: string, id: string, userId: string | null) =>
    (await assignTask(db, tenantId, id, userId))
      ? ok({ status: userId ? 'claimed' : 'released' })
      : closed;

  return {
    queues: async (tenantId: string) => ok({ queues: await listQueues(db, tenantId) }),

    list: async (tenantId: string, filters: TaskFilters) =>
      ok({ tasks: await listTasks(db, tenantId, filters) }),

    find: async (tenantId: string, id: string) => {
      const task = await findTask(db, tenantId, id);
      return task ? ok({ task }) : notFound;
    },

    next: async (tenantId: string, queue: string, userId: string) =>
      ok({ task: (await claimNext(db, tenantId, queue, userId)) ?? null }),

    claim: (tenantId: string, id: string, userId: string) => assign(tenantId, id, userId),

    release: (tenantId: string, id: string) => assign(tenantId, id, null),

    complete: (tenantId: string, userId: string, id: string, completion: Completion) =>
      db.transaction().execute(async (tx) => {
        const task = await findTask(tx, tenantId, id);
        if (!task) return notFound;
        if (task.status !== 'open') return closed;
        if (!task.outcomes.includes(completion.outcome)) {
          return fail('invalid', `Unknown outcome "${completion.outcome}"`);
        }
        const checked = task.kind === 'task' || completion.outcome === 'skip';
        const fields = checked ? fieldErrors(task.fields, completion.values) : {};
        if (Object.keys(fields).length) {
          return fail('invalid', 'Some fields are invalid', { fields });
        }
        if (!(await completeTask(tx, { tenantId, id, userId, resolution: completion }))) {
          return closed;
        }
        await enqueueRuns(boss, sqlExecutor(tx), [jobFor(task, userId, completion)]);
        return ok({ status: 'completed' });
      })
  };
};

export type TaskService = ReturnType<typeof createTaskService>;
