import type { Database } from '@ugula/db';
import { type Kysely, sql } from 'kysely';

export const buildTasksTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('tasks')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn('tenant_id', 'uuid', (col) =>
      col.notNull().references('tenants.id').onDelete('cascade').onUpdate('cascade')
    )
    .addColumn('run_id', 'uuid', (col) =>
      col.notNull().references('workflow_runs.id').onDelete('cascade').onUpdate('cascade')
    )
    .addColumn('wait_id', 'text', (col) => col.notNull())
    .addColumn('kind', 'text', (col) => col.notNull())
    .addColumn('queue', 'text', (col) => col.notNull())
    .addColumn('title', 'text', (col) => col.notNull())
    .addColumn('instructions', 'text', (col) => col.notNull().defaultTo(''))
    .addColumn('context', 'jsonb', (col) => col.notNull())
    .addColumn('fields', 'jsonb', (col) => col.notNull())
    .addColumn('outcomes', sql`text[]`, (col) => col.notNull())
    .addColumn('defaults', 'jsonb')
    .addColumn('priority', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('open'))
    .addColumn('assignee_id', 'uuid', (col) =>
      col.references('users.id').onDelete('set null').onUpdate('cascade')
    )
    .addColumn('resolution', 'jsonb')
    .addColumn('completed_by', 'uuid', (col) =>
      col.references('users.id').onDelete('set null').onUpdate('cascade')
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('completed_at', 'timestamptz')
    .addUniqueConstraint('tasks_run_id_wait_id_unique', ['run_id', 'wait_id'])
    .addCheckConstraint('tasks_kind_check', sql`kind in ('task', 'fault')`)
    .addCheckConstraint('tasks_status_check', sql`status in ('open', 'completed', 'cancelled')`)
    .addCheckConstraint('tasks_outcomes_check', sql`cardinality(outcomes) > 0`);

export const buildTasksIndexes = (db: Kysely<Database>) => [
  db.schema
    .createIndex('idx_tasks_queue')
    .on('tasks')
    .columns(['tenant_id', 'queue', 'priority desc', 'created_at'])
    .where(sql.ref('status'), '=', 'open'),
  db.schema.createIndex('idx_tasks_assignee_id').on('tasks').column('assignee_id'),
  db.schema.createIndex('idx_tasks_completed_by').on('tasks').column('completed_by')
];

export const createTasksTable = async (db: Kysely<Database>) => {
  await buildTasksTable(db).execute();
  for (const index of buildTasksIndexes(db)) await index.execute();
};
