import type { Database, TaskStatus } from '@ugula/db';
import { type Kysely, sql } from 'kysely';

type Db = Kysely<Database>;

export type TaskFilters = {
  queue?: string;
  status: TaskStatus;
  assigneeId?: string;
  limit: number;
};

const summary = [
  'id',
  'run_id',
  'kind',
  'queue',
  'title',
  'priority',
  'status',
  'assignee_id',
  'created_at',
  'completed_at'
] as const;

const detail = [
  ...summary,
  'wait_id',
  'instructions',
  'context',
  'fields',
  'outcomes',
  'defaults',
  'resolution',
  'completed_by'
] as const;

export const listQueues = (db: Db, tenantId: string) =>
  db
    .selectFrom('tasks')
    .select([
      'queue',
      sql<number>`count(*)::int`.as('open'),
      sql<number>`(count(*) filter (where assignee_id is null))::int`.as('unassigned'),
      sql<Date>`min(created_at)`.as('oldest')
    ])
    .where('tenant_id', '=', tenantId)
    .where('status', '=', 'open')
    .groupBy('queue')
    .orderBy('queue')
    .execute();

export const listTasks = (db: Db, tenantId: string, f: TaskFilters) => {
  let q = db
    .selectFrom('tasks')
    .select(summary)
    .where('tenant_id', '=', tenantId)
    .where('status', '=', f.status);
  if (f.queue) q = q.where('queue', '=', f.queue);
  if (f.assigneeId) q = q.where('assignee_id', '=', f.assigneeId);
  return q.orderBy('priority', 'desc').orderBy('created_at').limit(f.limit).execute();
};

export const findTask = (db: Db, tenantId: string, id: string) =>
  db
    .selectFrom('tasks')
    .select(detail)
    .where('tenant_id', '=', tenantId)
    .where('id', '=', id)
    .executeTakeFirst();

export const claimNext = (db: Db, tenantId: string, queue: string, userId: string) =>
  db
    .updateTable('tasks')
    .set({ assignee_id: userId, updated_at: sql`now()` })
    .where('id', '=', (eb) =>
      eb
        .selectFrom('tasks')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where('queue', '=', queue)
        .where('status', '=', 'open')
        .where('assignee_id', 'is', null)
        .orderBy('priority', 'desc')
        .orderBy('created_at')
        .limit(1)
        .forUpdate()
        .skipLocked()
    )
    .returning(detail)
    .executeTakeFirst();

export const assignTask = (db: Db, tenantId: string, id: string, userId: string | null) =>
  db
    .updateTable('tasks')
    .set({ assignee_id: userId, updated_at: sql`now()` })
    .where('tenant_id', '=', tenantId)
    .where('id', '=', id)
    .where('status', '=', 'open')
    .returning('id')
    .executeTakeFirst();

export const completeTask = (
  db: Db,
  input: { tenantId: string; id: string; userId: string; resolution: unknown }
) =>
  db
    .updateTable('tasks')
    .set({
      status: 'completed',
      completed_by: input.userId,
      completed_at: sql`now()`,
      resolution: JSON.stringify(input.resolution),
      updated_at: sql`now()`
    })
    .where('tenant_id', '=', input.tenantId)
    .where('id', '=', input.id)
    .where('status', '=', 'open')
    .returning('id')
    .executeTakeFirst();
