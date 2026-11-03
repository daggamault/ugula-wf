import { type Database, RUN_STATUSES } from '@ugula/db';
import { type Kysely, sql } from 'kysely';

const buildWorkflowRunsTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('workflow_runs')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn('tenant_id', 'uuid', (col) =>
      col.notNull().references('tenants.id').onDelete('cascade').onUpdate('cascade')
    )
    .addColumn('graph_version_id', 'uuid', (col) =>
      col.notNull().references('graph_versions.id').onDelete('no action').onUpdate('cascade')
    )
    .addColumn('parent_id', 'uuid', (col) =>
      col.references('workflow_runs.id').onDelete('cascade').onUpdate('cascade')
    )
    .addColumn('parent_wait', 'text')
    .addColumn('parent_index', 'integer')
    .addColumn('status', 'text', (col) => col.notNull())
    .addColumn('inputs', 'jsonb', (col) => col.notNull())
    .addColumn('state', 'jsonb')
    .addColumn('result', 'jsonb')
    .addColumn('error', 'jsonb')
    .addColumn('wait_key', 'text')
    .addColumn('lease_until', 'timestamptz')
    .addColumn('lease_token', 'uuid')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('completed_at', 'timestamptz')
    .addUniqueConstraint('workflow_runs_tenant_id_id_unique', ['tenant_id', 'id'])
    .addCheckConstraint(
      'workflow_runs_status_check',
      sql`status in (${sql.join(RUN_STATUSES.map((v) => sql.lit(v)))})`
    )
    .addCheckConstraint(
      'workflow_runs_parent_check',
      sql`(parent_id is null) = (parent_wait is null) and (parent_id is null) = (parent_index is null)`
    );

const buildWorkflowRunsIndexes = (db: Kysely<Database>) => [
  db.schema
    .createIndex('idx_workflow_runs_tenant_status')
    .on('workflow_runs')
    .columns(['tenant_id', 'status', 'created_at desc']),
  db.schema
    .createIndex('idx_workflow_runs_graph_version_id')
    .on('workflow_runs')
    .column('graph_version_id'),
  db.schema
    .createIndex('idx_workflow_runs_parent')
    .on('workflow_runs')
    .columns(['parent_id', 'parent_wait', 'parent_index']),
  db.schema
    .createIndex('idx_workflow_runs_wait_key')
    .on('workflow_runs')
    .columns(['tenant_id', 'wait_key'])
    .where('wait_key', 'is not', null),
  db.schema
    .createIndex('idx_workflow_runs_lease')
    .on('workflow_runs')
    .column('lease_until')
    .where(sql.ref('status'), '=', 'running')
];

const buildWorkflowRunStepsTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('workflow_run_steps')
    .addColumn('run_id', 'uuid', (col) =>
      col.notNull().references('workflow_runs.id').onDelete('cascade').onUpdate('cascade')
    )
    .addColumn('seq', 'integer', (col) => col.notNull())
    .addColumn('scope', 'text', (col) => col.notNull())
    .addColumn('path', 'text', (col) => col.notNull())
    .addColumn('node', 'text', (col) => col.notNull())
    .addColumn('node_type', 'text', (col) => col.notNull())
    .addColumn('node_version', 'integer', (col) => col.notNull())
    .addColumn('event', 'text', (col) => col.notNull())
    .addColumn('inputs', 'jsonb', (col) => col.notNull())
    .addColumn('outputs', 'jsonb', (col) => col.notNull())
    .addColumn('pin', 'text')
    .addColumn('error', 'jsonb')
    .addColumn('started_at', 'timestamptz', (col) => col.notNull())
    .addColumn('duration_ms', 'double precision', (col) => col.notNull())
    .addPrimaryKeyConstraint('workflow_run_steps_pkey', ['run_id', 'seq']);

const buildWorkflowRunStepsNodeIndex = (db: Kysely<Database>) =>
  db.schema
    .createIndex('idx_workflow_run_steps_node')
    .on('workflow_run_steps')
    .columns(['run_id', 'path', 'node', 'seq']);

const buildSignalsTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('signals')
    .addColumn('tenant_id', 'uuid', (col) =>
      col.notNull().references('tenants.id').onDelete('cascade').onUpdate('cascade')
    )
    .addColumn('key', 'text', (col) => col.notNull())
    .addColumn('received', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addPrimaryKeyConstraint('signals_pkey', ['tenant_id', 'key'])
    .addCheckConstraint('signals_received_check', sql`received >= 0`);

const buildWorkflowRunGraphsTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('workflow_run_graphs')
    .addColumn('run_id', 'uuid', (col) =>
      col.notNull().references('workflow_runs.id').onDelete('cascade').onUpdate('cascade')
    )
    .addColumn('key', 'text', (col) => col.notNull())
    .addColumn('version', 'integer', (col) => col.notNull())
    .addColumn('graph_version_id', 'uuid', (col) =>
      col.notNull().references('graph_versions.id').onDelete('no action').onUpdate('cascade')
    )
    .addPrimaryKeyConstraint('workflow_run_graphs_pkey', ['run_id', 'key', 'version']);

const buildWorkflowRunGraphsVersionIndex = (db: Kysely<Database>) =>
  db.schema
    .createIndex('idx_workflow_run_graphs_graph_version_id')
    .on('workflow_run_graphs')
    .column('graph_version_id');

export const createWorkflowRunsTables = async (db: Kysely<Database>) => {
  await buildWorkflowRunsTable(db).execute();
  for (const index of buildWorkflowRunsIndexes(db)) await index.execute();
  await buildWorkflowRunGraphsTable(db).execute();
  await buildWorkflowRunGraphsVersionIndex(db).execute();
  await buildWorkflowRunStepsTable(db).execute();
  await buildWorkflowRunStepsNodeIndex(db).execute();
  await buildSignalsTable(db).execute();
};
