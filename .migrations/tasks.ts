import { PERMISSIONS } from '@ugula/access';
import { type Database, TASK_KINDS, TASK_STATUSES } from '@ugula/db';
import { type Kysely, sql } from 'kysely';

const buildTasksTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('tasks')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn('agency_id', 'uuid', (col) =>
      col.notNull().references('agencies.id').onDelete('cascade').onUpdate('cascade')
    )
    .addColumn('run_id', 'uuid', (col) =>
      col.notNull().references('workflow_runs.id').onDelete('cascade').onUpdate('cascade')
    )
    .addColumn('wait_id', 'text', (col) => col.notNull())
    .addColumn('kind', 'text', (col) => col.notNull())
    .addColumn('queue', 'text', (col) => col.notNull())
    .addColumn('title', 'text', (col) => col.notNull())
    .addColumn('subject', 'text')
    .addColumn('summary', 'text')
    .addColumn('instructions', 'text', (col) => col.notNull().defaultTo(''))
    .addColumn('context', 'json', (col) => col.notNull())
    .addColumn('fields', 'jsonb', (col) => col.notNull())
    .addColumn('outcomes', sql`text[]`, (col) => col.notNull())
    .addColumn('defaults', 'jsonb')
    .addColumn('priority', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('due_at', 'timestamptz')
    .addColumn('permission', 'text')
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('open'))
    .addColumn('assignee_id', 'uuid')
    .addColumn('resolution', 'jsonb')
    .addColumn('completed_by', 'uuid')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('completed_at', 'timestamptz')
    .addUniqueConstraint('tasks_run_id_wait_id_unique', ['run_id', 'wait_id'])
    .addCheckConstraint(
      'tasks_kind_check',
      sql`kind in (${sql.join(TASK_KINDS.map((v) => sql.lit(v)))})`
    )
    .addCheckConstraint(
      'tasks_status_check',
      sql`status in (${sql.join(TASK_STATUSES.map((v) => sql.lit(v)))})`
    )
    .addCheckConstraint('tasks_outcomes_check', sql`cardinality(outcomes) > 0`)
    .addCheckConstraint(
      'tasks_permission_check',
      sql`permission in (${sql.join(PERMISSIONS.map((v) => sql.lit(v)))})`
    );

const buildTasksIndexes = (db: Kysely<Database>) => [
  db.schema
    .createIndex('idx_tasks_queue')
    .on('tasks')
    .columns(['agency_id', 'queue', 'priority desc', 'created_at'])
    .where(sql.ref('status'), '=', 'open'),
  db.schema
    .createIndex('idx_tasks_open')
    .on('tasks')
    .expression(sql`agency_id, (assignee_id is null), priority desc, created_at`)
    .where(sql.ref('status'), '=', 'open'),
  db.schema.createIndex('idx_tasks_assignee_id').on('tasks').column('assignee_id'),
  db.schema.createIndex('idx_tasks_completed_by').on('tasks').column('completed_by'),
  db.schema
    .createIndex('idx_tasks_completed')
    .on('tasks')
    .columns(['agency_id', 'completed_at'])
    .where(sql.ref('status'), '=', 'completed')
];

const buildTasksForeignKeys = () => [
  sql`alter table tasks add constraint tasks_assignee_id_fkey
  foreign key (assignee_id) references users (id) on delete set null on update cascade`,
  sql`alter table tasks add constraint tasks_completed_by_fkey
  foreign key (completed_by) references users (id) on delete set null on update cascade`
];

export const createTasksTable = async (db: Kysely<Database>) => {
  await buildTasksTable(db).execute();
  for (const fk of buildTasksForeignKeys()) await fk.execute(db);
  for (const index of buildTasksIndexes(db)) await index.execute();
};
