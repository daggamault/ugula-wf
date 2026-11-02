import type { ClaimEventKind, ClaimStatus } from '@ugula/billing';
import type { ColumnType, Generated, GeneratedAlways, Kysely } from 'kysely';

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

export type NotificationIntent = 'primary' | 'success' | 'info' | 'warning' | 'danger';

export type NotificationsTable = {
  id: Generated<string>;
  tenant_id: string;
  user_id: string | null;
  intent: ColumnType<NotificationIntent, NotificationIntent | undefined, NotificationIntent>;
  title: string;
  description: string | null;
  link_label: string | null;
  link_to: string | null;
  created_at: Timestamp;
};

export type NotificationStatesTable = {
  user_id: string;
  read_at: Timestamp;
  cleared_at: Date | string | null;
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
  is_active: Generated<boolean>;
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

export type WorkflowRunGraphsTable = {
  run_id: string;
  key: string;
  version: number;
  graph_version_id: string;
};

export type GnisPlacesTable = {
  id: number;
  name: string;
  state: string;
};

export type NemsisElementsTable = {
  element: string;
  name: string;
  definition: string;
  usage: string;
};

export type NemsisCodesTable = {
  list: string;
  code: string;
  description: string;
};

export type SignalsTable = {
  tenant_id: string;
  key: string;
  received: Generated<number>;
  updated_at: Timestamp;
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
  subject: string | null;
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
  number: GeneratedAlways<number>;
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
  payer_id: string | null;
  code: string;
  amount_cents: number;
  created_at: Timestamp;
  updated_at: Timestamp;
};

export type ClaimsTable = {
  id: Generated<string>;
  number: GeneratedAlways<number>;
  tenant_id: string;
  patient_id: string;
  import_report_id: string | null;
  pcr_number: string | null;
  level: string | null;
  emergency: boolean | null;
  loaded_miles: ColumnType<string | null, number | null, number | null>;
  total_cents: Generated<number>;
  service_date: ColumnType<string | null, string | null, string | null>;
  origin_code: string | null;
  destination_code: string | null;
  pickup_address_line: string | null;
  pickup_city: string | null;
  pickup_state: string | null;
  pickup_postal_code: string | null;
  destination_name: string | null;
  destination_address_line: string | null;
  destination_city: string | null;
  destination_state: string | null;
  destination_postal_code: string | null;
  status: Generated<ClaimStatus>;
  cycle_run_id: string | null;
  source_key: string;
  created_at: Timestamp;
  updated_at: Timestamp;
};

export type ClaimLinesTable = {
  claim_id: string;
  position: number;
  code: string;
  units: ColumnType<string, number, number>;
  unit_cents: number;
  total_cents: number;
};

export type ClaimCoveragesTable = {
  id: Generated<string>;
  claim_id: string;
  position: number;
  payer_name: string;
  payer_id: string | null;
  payer_code: string | null;
  member_id: string | null;
  group_id: string | null;
};

export type ClaimDiagnosesTable = {
  claim_id: string;
  position: number;
  code: string;
};

export type ClaimBalancesView = {
  claim_id: string;
  paid_cents: number;
  adjusted_cents: number;
  balance_cents: number;
};

export type ClaimEventsTable = {
  id: Generated<string>;
  claim_id: string;
  kind: ClaimEventKind;
  coverage_id: string | null;
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

export const IMPORT_SOURCES = ['upload', 'sftp', 'manual'] as const;

export type ImportSource = (typeof IMPORT_SOURCES)[number];

export type ImportsTable = {
  id: Generated<string>;
  tenant_id: string;
  run_id: string;
  source: ImportSource;
  file_name: string;
  file: JsonColumn;
  report_count: number | null;
  uploaded_by: string | null;
  created_at: Timestamp;
};

export type ImportReportsTable = {
  id: Generated<string>;
  import_id: string;
  position: number;
  pcr_number: string | null;
  report: JsonColumn;
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
  embedding: ColumnType<string | null, string | null | undefined, string | null>;
  created_at: Timestamp;
  updated_at: Timestamp;
};

export const EMBEDDING_DIMENSIONS = 1024;

export type PayerAliasesTable = {
  id: Generated<string>;
  tenant_id: string;
  payer_id: string;
  alias: string;
  alias_key: string;
  created_at: Timestamp;
};

export type Database = {
  tenants: TenantsTable;
  users: UsersTable;
  graphs: GraphsTable;
  graph_versions: GraphVersionsTable;
  workflow_runs: WorkflowRunsTable;
  workflow_run_steps: WorkflowRunStepsTable;
  workflow_run_graphs: WorkflowRunGraphsTable;
  gnis_places: GnisPlacesTable;
  nemsis_elements: NemsisElementsTable;
  nemsis_codes: NemsisCodesTable;
  signals: SignalsTable;
  tasks: TasksTable;
  patients: PatientsTable;
  fee_schedules: FeeSchedulesTable;
  imports: ImportsTable;
  import_reports: ImportReportsTable;
  claims: ClaimsTable;
  claim_lines: ClaimLinesTable;
  claim_coverages: ClaimCoveragesTable;
  claim_diagnoses: ClaimDiagnosesTable;
  claim_balances: ClaimBalancesView;
  claim_events: ClaimEventsTable;
  claim_batches: ClaimBatchesTable;
  billing_profiles: BillingProfilesTable;
  payers: PayersTable;
  payer_aliases: PayerAliasesTable;
  notifications: NotificationsTable;
  notification_states: NotificationStatesTable;
};

export type Db = Kysely<Database>;

export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = ['completed', 'failed', 'cancelled'];

export const ACTIVE_RUN_STATUSES: readonly RunStatus[] = ['running', 'suspended', 'faulted'];
