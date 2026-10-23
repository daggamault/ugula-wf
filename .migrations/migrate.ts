import { createDb, type Database, type Db } from '@ugula/db';
import { type Kysely, sql } from 'kysely';
import { createBillingProfilesTables } from './billing-profiles.ts';
import { createClaimsTables } from './claims.ts';
import { parseConfig } from './config.ts';
import { createFeeSchedulesTable } from './fee-schedules.ts';
import { createGraphsTables } from './graphs.ts';
import { createPatientsTable } from './patients.ts';
import { createTasksTable } from './tasks.ts';
import { createTenantsTable } from './tenants.ts';
import { createUsersTable } from './users.ts';
import { createWorkflowRunsTables } from './workflow-runs.ts';

export const resetSchema = async (db: Kysely<Database>) => {
  for (const table of [
    'claim_events',
    'claim_batches',
    'payers',
    'billing_profiles',
    'claims',
    'fee_schedules',
    'patients',
    'tasks',
    'workflow_run_steps',
    'workflow_runs',
    'graph_versions',
    'graphs',
    'users',
    'tenants'
  ] as const) {
    await db.schema.dropTable(table).ifExists().cascade().execute();
  }
  await sql`drop function if exists prevent_published_graph_change`.execute(db);
};

export const steps = [
  resetSchema,
  createTenantsTable,
  createUsersTable,
  createGraphsTables,
  createWorkflowRunsTables,
  createTasksTable,
  createPatientsTable,
  createFeeSchedulesTable,
  createBillingProfilesTables,
  createClaimsTables
] as const;

export const migrate = async (db: Db) => {
  await db.transaction().execute(async (tx) => {
    for (const step of steps) {
      await step(tx);
    }
  });
};

if (import.meta.main) {
  const config = parseConfig(process.env);
  const db = createDb({
    host: config.DB_HOST,
    port: config.DB_PORT,
    user: config.DB_USER,
    password: config.DB_PASSWORD,
    database: config.DB_NAME
  });
  try {
    await migrate(db);
  } finally {
    await db.destroy();
  }
}
