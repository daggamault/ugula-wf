import {
  type ColumnType,
  CompiledQuery,
  type DatabaseConnection,
  DummyDriver,
  type Generated,
  Kysely,
  PostgresAdapter,
  PostgresDialect,
  PostgresIntrospector,
  PostgresQueryCompiler
} from 'kysely';
import { Pool, type PoolConfig, types } from 'pg';

export type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;

export type TenantsTable = {
  id: Generated<string>;
  name: string;
  slug: string;
  sftp_username: string | null;
  sftp_password_hash: string | null;
  is_active: Generated<boolean>;
  created_at: Timestamp;
  updated_at: Timestamp;
};

export type UsersTable = {
  id: Generated<string>;
  tenant_id: string;
  email: string;
  password_hash: string;
  is_active: Generated<boolean>;
  created_at: Timestamp;
  updated_at: Timestamp;
};

export type JsonColumn<T = unknown> = ColumnType<T, string, string>;

export type NullableJsonColumn<T = unknown> = ColumnType<
  T | null,
  string | null | undefined,
  string | null
>;

export type GraphKind = 'workflow' | 'node';

export type GraphsTable = {
  id: Generated<string>;
  tenant_id: string | null;
  key: string;
  name: string;
  kind: GraphKind;
  description: Generated<string>;
  created_at: Timestamp;
  updated_at: Timestamp;
};

export type GraphVersionsTable = {
  id: Generated<string>;
  graph_id: string;
  version: number;
  definition: JsonColumn;
  dependencies: ColumnType<string[], string[] | undefined, string[]>;
  published_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  created_by: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
};

export type RunStatus = 'running' | 'suspended' | 'completed' | 'faulted' | 'failed' | 'cancelled';

export type WorkflowRunsTable = {
  id: Generated<string>;
  tenant_id: string;
  graph_version_id: string;
  parent_id: string | null;
  parent_wait: string | null;
  parent_index: number | null;
  status: RunStatus;
  inputs: JsonColumn;
  state: NullableJsonColumn;
  result: NullableJsonColumn;
  error: NullableJsonColumn;
  wait_key: string | null;
  lease_until: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  lease_token: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
  completed_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
};

export type WorkflowRunStepsTable = {
  run_id: string;
  seq: number;
  scope: string;
  path: string;
  node: string;
  node_type: string;
  node_version: number;
  event: string;
  inputs: JsonColumn;
  outputs: JsonColumn;
  pin: string | null;
  error: NullableJsonColumn;
  started_at: ColumnType<Date, Date | string, Date | string>;
  duration_ms: number;
};

export type TaskKind = 'task' | 'fault';

export type TaskStatus = 'open' | 'completed' | 'cancelled';

export type TasksTable = {
  id: Generated<string>;
  tenant_id: string;
  run_id: string;
  wait_id: string;
  kind: TaskKind;
  queue: string;
  title: string;
  instructions: Generated<string>;
  context: JsonColumn;
  fields: JsonColumn;
  outcomes: ColumnType<string[], string[], string[]>;
  defaults: NullableJsonColumn;
  priority: Generated<number>;
  status: Generated<TaskStatus>;
  assignee_id: string | null;
  resolution: NullableJsonColumn;
  completed_by: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
  completed_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
};

export type PatientsTable = {
  id: Generated<string>;
  tenant_id: string;
  first_name: string;
  last_name: string;
  last_name_key: string;
  birth_date: ColumnType<string, string, string>;
  gender: string | null;
  address_line: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  source_key: string;
  created_at: Timestamp;
  updated_at: Timestamp;
};

export type FeeSchedulesTable = {
  id: Generated<string>;
  tenant_id: string;
  payer: string | null;
  code: string;
  amount_cents: number;
  created_at: Timestamp;
  updated_at: Timestamp;
};

export type ClaimStatus = 'open' | 'paid' | 'written_off' | 'collections';

export type ClaimEventKind =
  | 'submitted'
  | 'resubmitted'
  | 'resubmit_queued'
  | 'follow_up'
  | 'response'
  | 'payer_skipped'
  | 'statement'
  | 'closed';

export type ClaimsTable = {
  id: Generated<string>;
  tenant_id: string;
  patient_id: string;
  pcr_number: string | null;
  level: string;
  emergency: boolean;
  loaded_miles: ColumnType<string | null, number | null, number | null>;
  lines: JsonColumn;
  total_cents: number;
  payers: ColumnType<string[], string[] | undefined, string[]>;
  coverages: ColumnType<unknown, string | undefined, string>;
  details: ColumnType<unknown, string | undefined, string>;
  status: Generated<ClaimStatus>;
  cycle_run_id: string | null;
  source_key: string;
  created_at: Timestamp;
  updated_at: Timestamp;
};

export type ClaimEventsTable = {
  id: Generated<string>;
  claim_id: string;
  kind: ClaimEventKind;
  payer: string | null;
  paid_cents: Generated<number>;
  adjusted_cents: Generated<number>;
  note: Generated<string>;
  document: NullableJsonColumn;
  created_by: string | null;
  source_key: string | null;
  batch_id: string | null;
  created_at: Timestamp;
};

export type ClaimBatchesTable = {
  id: Generated<string>;
  tenant_id: string;
  control_number: number;
  claim_count: number;
  total_cents: number;
  production: boolean;
  document: JsonColumn;
  created_by: string | null;
  created_at: Timestamp;
};

export type BillingProfilesTable = {
  tenant_id: string;
  organization_name: string;
  npi: string;
  tax_id: string;
  address_line: string;
  city: string;
  state: string;
  postal_code: string;
  phone: string;
  submitter_id: string | null;
  receiver_id: string | null;
  receiver_name: string | null;
  production: Generated<boolean>;
  updated_at: Timestamp;
};

export type PayersTable = {
  id: Generated<string>;
  tenant_id: string;
  name: string;
  payer_id: string;
  claim_filing: string;
  created_at: Timestamp;
  updated_at: Timestamp;
};

export type Database = {
  tenants: TenantsTable;
  users: UsersTable;
  graphs: GraphsTable;
  graph_versions: GraphVersionsTable;
  workflow_runs: WorkflowRunsTable;
  workflow_run_steps: WorkflowRunStepsTable;
  tasks: TasksTable;
  patients: PatientsTable;
  fee_schedules: FeeSchedulesTable;
  claims: ClaimsTable;
  claim_events: ClaimEventsTable;
  claim_batches: ClaimBatchesTable;
  billing_profiles: BillingProfilesTable;
  payers: PayersTable;
};

export type Db = Kysely<Database>;

export const typeParsers = {
  getTypeParser: ((oid: number, format?: 'text' | 'binary') =>
    oid === types.builtins.DATE
      ? (value: string) => value
      : types.getTypeParser(oid, format)) as typeof types.getTypeParser
} satisfies NonNullable<PoolConfig['types']>;

export const createDb = (config: PoolConfig): Db =>
  new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: new Pool({ ...config, types: typeParsers })
    })
  });

export type SqlExecutor = {
  executeSql: (text: string, values?: unknown[]) => Promise<{ rows: unknown[] }>;
};

export const sqlExecutor = (db: Kysely<Database>): SqlExecutor => ({
  executeSql: async (text, values = []) => ({
    rows: [...(await db.executeQuery(CompiledQuery.raw(text, values))).rows]
  })
});

export const createDummyDb = (): Db =>
  new Kysely<Database>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler()
    }
  });

export type RowsFor = (query: CompiledQuery) => unknown[];

export const createRecordingDb = (rowsFor: RowsFor = () => []) => {
  const queries: CompiledQuery[] = [];
  const conn: DatabaseConnection = {
    executeQuery: async <R>(q: CompiledQuery) => {
      queries.push(q);
      const rows = rowsFor(q) as R[];
      return { rows, numAffectedRows: BigInt(rows.length) };
    },
    streamQuery: async function* () {
      yield* [];
    }
  };
  const db = new Kysely<Database>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => Object.assign(new DummyDriver(), { acquireConnection: async () => conn }),
      createIntrospector: (k) => new PostgresIntrospector(k),
      createQueryCompiler: () => new PostgresQueryCompiler()
    }
  });
  return { db, queries };
};

export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = ['completed', 'failed', 'cancelled'];

export const ACTIVE_RUN_STATUSES: readonly RunStatus[] = ['running', 'suspended', 'faulted'];

export * from './graphs.ts';
