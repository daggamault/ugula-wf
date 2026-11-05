import type { Permission } from '@ugula/access';
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
  listQueues,
  listTasks,
  type TaskFilters
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

const unpermitted = (permission: Permission) =>
  fail('forbidden', `Completing this task needs the ${permission} permission`);

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

  const reassign = async (agencyId: string, id: string, userId: string, assignee: string | null) =>
    (await assignTask(db, { agencyId, id, userId, assignee }))
      ? ok({ status: assignee ? 'claimed' : 'released' })
      : (blocked(await findTask(db, agencyId, id), userId) ?? closed);

  const assign = (agencyId: string, id: string, userId: string, assignee: string | null) =>
    announced(announce, agencyId, reassign(agencyId, id, userId, assignee), () => changed(id));

  return {
    queues: async (agencyId: string, userId: string) =>
      ok({ queues: await listQueues(db, agencyId, userId) }),

    list: async (agencyId: string, userId: string, filters: TaskFilters) =>
      ok(await listTasks(db, agencyId, userId, filters)),

    find: async (agencyId: string, id: string) => {
      const task = await findTask(db, agencyId, id);
      if (!task) return notFound;
      const source = await findTaskSource(db, task.run_id);
      const claim =
        source?.claim_id && source.claim_number !== null && source.claim_status
          ? {
              id: source.claim_id,
              number: source.claim_number,
              status: source.claim_status,
              patient: source.last_name ? `${source.last_name}, ${source.first_name}` : null,
              birthDate: source.birth_date,
              serviceDate: source.service_date,
              tripType: source.trip_type,
              level: source.level,
              emergency: source.emergency,
              loadedMiles: source.loaded_miles,
              totalCents: source.total_cents,
              balanceCents: source.balance_cents,
              payers: source.payers,
              lines: source.lines
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

    next: (
      agencyId: string,
      queue: string | null,
      userId: string,
      permissions: readonly Permission[]
    ) =>
      announced(
        announce,
        agencyId,
        claimNext(db, agencyId, queue, userId, permissions).then((task) =>
          ok({ task: task ?? null })
        ),
        ({ task }) => (task ? changed(task.id) : [])
      ),

    claim: async (
      agencyId: string,
      id: string,
      userId: string,
      permissions: readonly Permission[]
    ) => {
      const task = await findTask(db, agencyId, id);
      if (!task) return notFound;
      if (task.permission && !permissions.includes(task.permission)) {
        return unpermitted(task.permission);
      }
      return assign(agencyId, id, userId, userId);
    },

    release: (agencyId: string, id: string, userId: string) => assign(agencyId, id, userId, null),

    complete: (
      agencyId: string,
      userId: string,
      id: string,
      completion: Completion,
      permissions: readonly Permission[]
    ) =>
      announced(
        announce,
        agencyId,
        db.transaction().execute(async (tx) => {
          const task = await findTask(tx, agencyId, id);
          if (!task) return notFound;
          const refused = blocked(task, userId);
          if (refused) return refused;
          if (task.permission && !permissions.includes(task.permission)) {
            return unpermitted(task.permission);
          }
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
          if (!(await completeTask(tx, { agencyId, id, userId, resolution: completion }))) {
            return blocked(await findTask(tx, agencyId, id), userId) ?? closed;
          }
          await enqueueRuns(boss, sqlExecutor(tx), [jobFor(task, userId, completion)]);
          return ok({ status: 'completed' });
        }),
        () => changed(id)
      )
  };
};

export type TaskService = ReturnType<typeof createTaskService>;
