import type { Permission } from '@ugula/access';
import { agencyTimeZone, type Database, type TaskKind, type TaskPrefill } from '@ugula/db';
import type { Json } from '@ugula/graph';
import { type Kysely, sql } from 'kysely';

export type TaskInsert = {
  agencyId: string;
  runId: string;
  waitId: string;
  kind: TaskKind;
  queue: string;
  title: string;
  subject: string | null;
  summary: string | null;
  instructions: string;
  context: Json;
  fields: Json;
  outcomes: string[];
  hints?: Readonly<Record<string, string>>;
  defaults: Json;
  prefill?: TaskPrefill | null;
  priority: number;
  assigneeId: string | null;
  dueAt: string | null;
  permission: Permission | null;
};

export const taskNotification = (
  t: { agencyId: string; kind: 'task' | 'fault'; title: string; subject: string | null },
  id: string
) => ({
  agency_id: t.agencyId,
  intent: t.kind === 'fault' ? ('danger' as const) : ('info' as const),
  title: t.kind === 'fault' ? `Stuck run: ${t.title}` : `New task: ${t.title}`,
  description: t.subject,
  link_label: 'Open task',
  link_to: `/tasks/${id}`
});

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const dueAtOf = (agencyId: string, due: string) =>
  DATE_ONLY.test(due)
    ? sql<string>`(${due}::date + interval '1 day' - interval '1 second') at time zone ${agencyTimeZone(agencyId)}`
    : due;

export const insertTask = async (tx: Kysely<Database>, t: TaskInsert) => {
  const task = await tx
    .insertInto('tasks')
    .values({
      agency_id: t.agencyId,
      run_id: t.runId,
      wait_id: t.waitId,
      kind: t.kind,
      queue: t.queue,
      title: t.title,
      subject: t.subject,
      summary: t.summary,
      instructions: t.instructions,
      context: JSON.stringify(t.context),
      fields: JSON.stringify(t.fields),
      outcomes: t.outcomes,
      hints: JSON.stringify(t.hints ?? {}),
      defaults: JSON.stringify(t.defaults),
      prefill: t.prefill ?? null,
      priority: t.priority,
      due_at: t.dueAt === null ? null : dueAtOf(t.agencyId, t.dueAt),
      permission: t.permission,
      assignee_id:
        t.assigneeId === null
          ? null
          : tx
              .selectFrom('memberships')
              .select('user_id')
              .where(sql<string>`user_id::text`, '=', t.assigneeId)
              .where('agency_id', '=', t.agencyId)
    })
    .onConflict((oc) => oc.columns(['run_id', 'wait_id']).doNothing())
    .returning('id')
    .executeTakeFirst();
  if (task) await tx.insertInto('notifications').values(taskNotification(t, task.id)).execute();
};

export const cancelTasks = async (tx: Kysely<Database>, runId: string) => {
  await tx
    .updateTable('tasks')
    .set({ status: 'cancelled', updated_at: sql`now()` })
    .where('run_id', '=', runId)
    .where('status', '=', 'open')
    .execute();
};
