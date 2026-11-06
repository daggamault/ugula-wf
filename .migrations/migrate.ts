import { createDb, type Database, type Db } from '@ugula/db';
import { type Kysely, sql } from 'kysely';
import { createAgenciesTable } from './agencies.ts';
import { createBillingProfilesTables } from './billing-profiles.ts';
import { createClaimsTables } from './claims.ts';
import { createClearinghouseConnectionsTable } from './clearinghouse-connections.ts';
import { createCodesTable } from './codes.ts';
import { parseConfig } from './config.ts';
import { createDataTablesTables } from './data-tables.ts';
import { createExtensions } from './extensions.ts';
import { createFacilitiesTables, createFacilityInvoiceClaimsTable } from './facilities.ts';
import { createFeeSchedulesTable } from './fee-schedules.ts';
import { createGnisPlacesTable } from './gnis-places.ts';
import { createGraphsTables } from './graphs.ts';
import { createImportsTables } from './imports.ts';
import { createNemsisDictionaryTables } from './nemsis-dictionary.ts';
import { createNotificationsTables } from './notifications.ts';
import { createDailyNumbers, DAILY_NUMBER_FUNCTIONS } from './numbers.ts';
import { createPatientsTable } from './patients.ts';
import { createPayerFilesTables } from './payer-files.ts';
import { createTasksTable } from './tasks.ts';
import { createUsersTables } from './users.ts';
import { createWorkflowRunsTables } from './workflow-runs.ts';

const resetSchema = async (db: Kysely<Database>) => {
  await db.schema.dropView('claim_balances').ifExists().execute();
  for (const table of [
    'notification_states',
    'notifications',
    'claim_event_remarks',
    'claim_event_adjustments',
    'claim_events',
    'claim_status_requests',
    'claim_batches',
    'claim_diagnoses',
    'claim_coverages',
    'claim_lines',
    'claim_runs',
    'claim_documents',
    'claims',
    'facility_invoice_claims',
    'facility_invoices',
    'facilities',
    'import_reports',
    'imports',
    'fee_schedules',
    'payer_suggestions',
    'payer_aliases',
    'payers',
    'clearinghouse_connections',
    'billing_profiles',
    'patients',
    'tasks',
    'daily_numbers',
    'signals',
    'schedule_runs',
    'clearinghouse_downloads',
    'payer_file_items',
    'payer_files',
    'workflow_run_tables',
    'data_table_versions',
    'data_tables',
    'workflow_run_steps',
    'workflow_run_graphs',
    'workflow_runs',
    'graph_versions',
    'graphs',
    'password_tokens',
    'invitations',
    'memberships',
    'role_permissions',
    'roles',
    'users',
    'agencies',
    'organizations',
    'codes',
    'gnis_places',
    'nemsis_codes',
    'nemsis_elements'
  ] as const) {
    await db.schema.dropTable(table).ifExists().cascade().execute();
  }
  await sql`drop function if exists prevent_published_graph_change`.execute(db);
  await sql`drop function if exists prevent_published_table_change`.execute(db);
  for (const name of [
    'check_graph_version_base',
    'check_run_graph_key',
    'check_table_version_base',
    'check_run_table_key',
    ...DAILY_NUMBER_FUNCTIONS
  ]) {
    await sql`drop function if exists ${sql.id(name)}`.execute(db);
  }
};

const steps = [
  resetSchema,
  createExtensions,
  createGnisPlacesTable,
  createCodesTable,
  createNemsisDictionaryTables,
  createAgenciesTable,
  createDailyNumbers,
  createUsersTables,
  createGraphsTables,
  createWorkflowRunsTables,
  createDataTablesTables,
  createTasksTable,
  createPatientsTable,
  createBillingProfilesTables,
  createClearinghouseConnectionsTable,
  createFeeSchedulesTable,
  createImportsTables,
  createFacilitiesTables,
  createClaimsTables,
  createFacilityInvoiceClaimsTable,
  createPayerFilesTables,
  createNotificationsTables
] as const;

const migrate = async (db: Db) => {
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
