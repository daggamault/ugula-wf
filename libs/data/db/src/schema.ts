import type { Permission } from '@ugula/access';
import type {
  AdjustmentGroup,
  AfterDownload,
  ClaimEventKind,
  ClaimFilingCode,
  ClaimStatus,
  Classification,
  ClearinghouseVendor,
  CodeSet,
  CorrectionMethod,
  DenialRoute,
  DocumentKind,
  EligibilityCheck,
  EligibilityStatus,
  FacilityKind,
  FacilityStay,
  InboundKind,
  InsuredRelationship,
  MspAccident,
  PayerFileOutcome,
  PcsType,
  PlanType,
  Rurality,
  ServiceLevel,
  Sex,
  SignatureStatus,
  StayKind,
  TransportReason
} from '@ugula/billing';
import type { StepEvent } from '@ugula/graph';
import type { PickList } from '@ugula/nemsis';
import type { ColumnType, Generated, GeneratedAlways, Kysely } from 'kysely';

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;

type NullableTimestamp = ColumnType<
  Date | null,
  Date | string | null | undefined,
  Date | string | null
>;

type NullableDate = ColumnType<string | null, string | null | undefined, string | null>;

export const USER_TYPES = ['platform', 'organization'] as const;

type UserType = (typeof USER_TYPES)[number];

type OrganizationsTable = {
  id: Generated<string>;
  name: string;
  is_active: Generated<boolean>;
  created_at: Timestamp;
  updated_at: Timestamp;
};

type AgenciesTable = {
  id: Generated<string>;
  organization_id: string;
  name: string;
  slug: string;
  sftp_username: string | null;
  sftp_password_hash: string | null;
  is_active: Generated<boolean>;
  created_at: Timestamp;
  updated_at: Timestamp;
};

type UsersTable = {
  id: Generated<string>;
  type: UserType;
  organization_id: string | null;
  is_owner: Generated<boolean>;
  email: string;
  first_name: string;
  last_name: string;
  password_hash: string;
  is_active: Generated<boolean>;
  created_at: Timestamp;
  updated_at: Timestamp;
};

type RolesTable = {
  id: Generated<string>;
  agency_id: string;
  name: string;
  version: Generated<number>;
  created_at: Timestamp;
  updated_at: Timestamp;
};

type RolePermissionsTable = {
  role_id: string;
  permission: Permission;
};

type MembershipsTable = {
  id: Generated<string>;
  organization_id: string;
  user_id: string;
  agency_id: string;
  role_id: string;
  version: Generated<number>;
  created_at: Timestamp;
  updated_at: Timestamp;
};

type InvitationsTable = {
  id: Generated<string>;
  agency_id: string;
  role_id: string;
  email: string;
  first_name: string;
  last_name: string;
  token_hash: string;
  invited_by_id: string | null;
  expires_at: Timestamp;
  created_at: Timestamp;
  updated_at: Timestamp;
};

type PasswordTokensTable = {
  id: Generated<string>;
  user_id: string;
  token_hash: string;
  expires_at: Timestamp;
  created_at: Timestamp;
};

export const NOTIFICATION_INTENTS = ['primary', 'success', 'info', 'warning', 'danger'] as const;

export type NotificationIntent = (typeof NOTIFICATION_INTENTS)[number];

type NotificationsTable = {
  id: Generated<string>;
  agency_id: string;
  user_id: string | null;
  intent: ColumnType<NotificationIntent, NotificationIntent | undefined, NotificationIntent>;
  title: string;
  description: string | null;
  link_label: string | null;
  link_to: string | null;
  created_at: Timestamp;
};

type NotificationStatesTable = {
  user_id: string;
  agency_id: string;
  read_at: Timestamp;
  cleared_at: NullableTimestamp;
};

type JsonColumn<T = unknown> = ColumnType<T, string, string>;

type NullableJsonColumn<T = unknown> = ColumnType<
  T | null,
  string | null | undefined,
  string | null
>;

export const GRAPH_KINDS = ['workflow', 'node'] as const;

export type GraphKind = (typeof GRAPH_KINDS)[number];

export const GRAPH_ROLES = ['workflow', 'stage', 'rule', 'slot'] as const;

export type GraphRole = (typeof GRAPH_ROLES)[number];

type GraphsTable = {
  id: Generated<string>;
  agency_id: string | null;
  key: string;
  name: string;
  kind: GraphKind;
  role: GraphRole;
  description: Generated<string>;
  is_active: Generated<boolean>;
  created_at: Timestamp;
  updated_at: Timestamp;
};

type GraphVersionsTable = {
  id: Generated<string>;
  graph_id: string;
  version: number;
  definition: JsonColumn;
  base_version_id: string | null;
  contract: string;
  dependencies: ColumnType<string[], string[] | undefined, string[]>;
  published_at: NullableTimestamp;
  created_by_id: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
};

export const RUN_STATUSES = [
  'running',
  'suspended',
  'completed',
  'faulted',
  'failed',
  'cancelled'
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

type WorkflowRunsTable = {
  id: Generated<string>;
  agency_id: string;
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
  lease_expires_at: NullableTimestamp;
  lease_token: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
  completed_at: NullableTimestamp;
  started_by_id: string | null;
};

type WorkflowRunGraphsTable = {
  run_id: string;
  key: string;
  version: number;
  graph_version_id: string;
};

export const TABLE_KINDS = ['decide', 'lookup'] as const;

export type TableKind = (typeof TABLE_KINDS)[number];

type DataTablesTable = {
  id: Generated<string>;
  organization_id: string | null;
  agency_id: string | null;
  key: string;
  name: string;
  kind: TableKind;
  description: Generated<string>;
  is_active: Generated<boolean>;
  created_at: Timestamp;
  updated_at: Timestamp;
};

type DataTableVersionsTable = {
  id: Generated<string>;
  table_id: string;
  version: number;
  definition: JsonColumn;
  base_version_id: string | null;
  contract: string;
  published_at: NullableTimestamp;
  created_by_id: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
};

type WorkflowRunTablesTable = {
  run_id: string;
  key: string;
  table_version_id: string;
};

type GnisPlacesTable = {
  id: number;
  name: string;
};

type NemsisElementsTable = {
  element: string;
  name: string;
};

type CodesTable = {
  code_set: CodeSet;
  code: string;
  description: string;
  is_billable: boolean;
};

type NemsisPickListsTable = {
  list: PickList;
  code_set: CodeSet;
  code: string;
};

type CmsZipLocalitiesTable = {
  postal_code: string;
  carrier: string;
  locality: string;
  rurality: Rurality;
  needs_plus_four: boolean;
};

type CmsZip4LocalitiesTable = {
  postal_code: string;
  plus_four_from: string;
  plus_four_to: string;
  carrier: string;
  locality: string;
  rurality: Rurality;
};

type CmsAmbulanceFeesTable = {
  year: number;
  carrier: string;
  locality: string;
  code: string;
  urban_cents: number;
  rural_cents: number;
  super_rural_cents: number | null;
  rural_short_trip_cents: number | null;
};

type CmsHospitalsTable = {
  ccn: string;
  name: string;
  address_line: string;
  city: string;
  state: string;
  postal_code: string;
  phone: string | null;
  hospital_type: string;
  has_emergency_services: boolean;
};

type GeonamesPostalCodesTable = {
  postal_code: string;
  city: string;
  state: string;
  county: string | null;
  county_fips: string | null;
  latitude: number;
  longitude: number;
};

type NemsisCodesTable = {
  list: string;
  code: string;
  description: string;
};

type DailyNumbersTable = {
  agency_id: string;
  kind: string;
  day: string;
  last: number;
};

type SignalsTable = {
  agency_id: string;
  key: string;
  received: Generated<number>;
  updated_at: Timestamp;
};

type ScheduleRunsTable = {
  agency_id: string;
  workflow: string;
  fire_on: string;
  created_at: Timestamp;
};

type WorkflowRunStepsTable = {
  run_id: string;
  seq: number;
  scope: string;
  path: string;
  node: string;
  node_type: string;
  node_version: number;
  event: StepEvent;
  inputs: JsonColumn;
  outputs: JsonColumn;
  pin: string | null;
  error: NullableJsonColumn;
  started_at: ColumnType<Date, Date | string, Date | string>;
  duration_ms: number;
};

export const TASK_KINDS = ['task', 'fault'] as const;

export type TaskKind = (typeof TASK_KINDS)[number];

export const TASK_STATUSES = ['open', 'completed', 'cancelled'] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PREFILLS = ['current', 'suggested'] as const;

export type TaskPrefill = (typeof TASK_PREFILLS)[number];

export const EXCHANGE_REQUEST_STATUSES = ['pending', 'answered', 'sent', 'unavailable'] as const;

type ExchangeRequestStatus = (typeof EXCHANGE_REQUEST_STATUSES)[number];

type TasksTable = {
  id: Generated<string>;
  agency_id: string;
  run_id: string;
  wait_id: string;
  kind: TaskKind;
  queue: string;
  title: string;
  subject: string | null;
  summary: string | null;
  instructions: Generated<string>;
  context: JsonColumn;
  fields: JsonColumn;
  outcomes: ColumnType<string[], string[], string[]>;
  hints: JsonColumn<Record<string, string>>;
  defaults: NullableJsonColumn;
  prefill: TaskPrefill | null;
  priority: Generated<number>;
  due_at: NullableTimestamp;
  permission: Permission | null;
  status: Generated<TaskStatus>;
  assignee_id: string | null;
  resolution: NullableJsonColumn;
  completed_by_id: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
  completed_at: NullableTimestamp;
};

export type PatientsTable = {
  id: Generated<string>;
  number: GeneratedAlways<string>;
  agency_id: string;
  first_name: string;
  last_name: string;
  last_name_key: string;
  birth_date: ColumnType<string, string, string>;
  gender: Sex | null;
  address_line: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  source_key: string;
  created_at: Timestamp;
  updated_at: Timestamp;
};

type FeeSchedulesTable = {
  id: Generated<string>;
  agency_id: string;
  payer_id: string | null;
  code: string;
  amount_cents: number;
  created_at: Timestamp;
  updated_at: Timestamp;
};

export type ClaimsTable = {
  id: Generated<string>;
  number: GeneratedAlways<string>;
  agency_id: string;
  patient_id: string | null;
  import_report_id: string | null;
  pcr_number: string | null;
  classification: Classification | null;
  level: ServiceLevel | null;
  is_emergency: boolean | null;
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
  signature: ColumnType<SignatureStatus, SignatureStatus | undefined, SignatureStatus>;
  signature_note: string | null;
  has_pcs: boolean | null;
  pcs_signed_on: ColumnType<string | null, string | null | undefined, string | null>;
  transport_reason: TransportReason | null;
  condition_codes: ColumnType<string[], string[] | undefined, string[]>;
  prior_authorization: string | null;
  weight_kg: ColumnType<string | null, number | null | undefined, number | null>;
  at_scene_at: NullableTimestamp;
  left_scene_at: NullableTimestamp;
  at_destination_at: NullableTimestamp;
  is_deceased: Generated<boolean>;
  non_covered_miles: ColumnType<string | null, number | null | undefined, number | null>;
  patient_count: number | null;
  closest_facility_miles: ColumnType<string | null, number | null | undefined, number | null>;
  has_abn: boolean | null;
  abn_signed_on: NullableDate;
  is_denial_expected: boolean | null;
  has_msp_employer_plan: boolean | null;
  has_msp_esrd: boolean | null;
  has_msp_disability: boolean | null;
  msp_employer_size: number | null;
  msp_accident: MspAccident | null;
  prior_authorization_expires_on: NullableDate;
  pcs_type: PcsType | null;
  round_trips: number | null;
  admitted_on: NullableDate;
  facility_stay: FacilityStay | null;
  status: Generated<ClaimStatus>;
  cycle_run_id: string | null;
  facility_id: ColumnType<string | null, string | null | undefined, string | null>;
  source_key: string;
  created_at: Timestamp;
  updated_at: Timestamp;
};

type FacilitiesTable = {
  id: Generated<string>;
  agency_id: string;
  name: string;
  address_line: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  phone: string | null;
  kind: ColumnType<FacilityKind, FacilityKind | undefined, FacilityKind>;
  has_contract: Generated<boolean>;
  contract_note: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
};

type FacilityInvoicesTable = {
  id: Generated<string>;
  agency_id: string;
  facility_id: string;
  period: ColumnType<string, string, string>;
  sequence: number;
  source_key: string;
  claim_count: number;
  total_cents: number;
  document: JsonColumn;
  created_at: Timestamp;
};

type FacilityInvoiceClaimsTable = {
  agency_id: string;
  invoice_id: string;
  facility_id: string;
  claim_id: string;
};

type ClaimRunsTable = {
  agency_id: string;
  run_id: string;
  claim_id: string;
};

type ClaimLinesTable = {
  claim_id: string;
  position: number;
  code: string;
  units: ColumnType<string, number, number>;
  unit_cents: number;
  total_cents: number;
};

type ClaimCoveragesTable = {
  id: Generated<string>;
  agency_id: string;
  claim_id: string;
  position: number;
  payer_name: string;
  payer_id: string | null;
  payer_code: string | null;
  member_id: string | null;
  group_id: string | null;
  relationship: InsuredRelationship;
  insured_first_name: string | null;
  insured_last_name: string | null;
  eligibility: ColumnType<
    EligibilityStatus | null,
    EligibilityStatus | null | undefined,
    EligibilityStatus | null
  >;
  eligibility_note: ColumnType<string | null, string | null | undefined, string | null>;
  eligibility_checked_at: NullableTimestamp;
  eligibility_requested_at: NullableTimestamp;
  stay_kind: ColumnType<StayKind | null, StayKind | null | undefined, StayKind | null>;
  stay_admitted_on: NullableDate;
  stay_discharged_on: NullableDate;
};

type ClaimDocumentsTable = {
  id: Generated<string>;
  agency_id: string;
  claim_id: string;
  kind: DocumentKind;
  file_name: string;
  document: JsonColumn;
  signed_on: NullableDate;
  uploaded_by_id: string | null;
  created_at: Timestamp;
};

type ClaimDiagnosesTable = {
  claim_id: string;
  position: number;
  code: string;
};

type ClaimBalancesView = {
  claim_id: string;
  paid_cents: number;
  adjusted_cents: number;
  balance_cents: number;
};

type ClaimEventsTable = {
  id: Generated<string>;
  agency_id: string;
  claim_id: string;
  kind: ClaimEventKind;
  coverage_id: string | null;
  paid_cents: Generated<number>;
  adjusted_cents: Generated<number>;
  payer_claim_number: string | null;
  paid_on: ColumnType<string | null, string | null | undefined, string | null>;
  check_number: string | null;
  note: Generated<string>;
  route: ColumnType<DenialRoute | null, DenialRoute | null | undefined, DenialRoute | null>;
  document: NullableJsonColumn;
  created_by_id: string | null;
  source_key: string | null;
  batch_id: string | null;
  created_at: Timestamp;
};

type ClaimEventAdjustmentsTable = {
  event_id: string;
  position: number;
  group_code: AdjustmentGroup;
  reason_code: string;
  amount_cents: number;
};

type ClaimEventLinesTable = {
  event_id: string;
  line: number;
  code: string;
  modifiers: ColumnType<string[], string[] | undefined, string[]>;
  paid_cents: number;
  units: ColumnType<string, number, number>;
};

type ClaimEventLineAdjustmentsTable = {
  event_id: string;
  line: number;
  position: number;
  group_code: AdjustmentGroup;
  reason_code: string;
  amount_cents: number;
};

type ClaimEventRemarksTable = {
  event_id: string;
  position: number;
  code: string;
};

type ClaimBatchesTable = {
  id: Generated<string>;
  agency_id: string;
  control_number: number;
  claim_count: number;
  total_cents: number;
  is_production: boolean;
  document: JsonColumn;
  created_by_id: string | null;
  created_at: Timestamp;
  sent_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  sent_as: ColumnType<string | null, string | null | undefined, string | null>;
};

type ClaimStatusRequestsTable = {
  id: Generated<string>;
  agency_id: string;
  claim_id: string;
  source_key: string;
  control_number: number;
  status: ColumnType<
    ExchangeRequestStatus,
    ExchangeRequestStatus | undefined,
    ExchangeRequestStatus
  >;
  note: ColumnType<string | null, string | null | undefined, string | null>;
  sent_as: ColumnType<string | null, string | null | undefined, string | null>;
  signals_seen: ColumnType<number | null, number | null | undefined, number | null>;
  created_at: Timestamp;
};

type EligibilityRequestsTable = {
  id: Generated<string>;
  agency_id: string;
  claim_id: string;
  source_key: string;
  control_number: number;
  status: ColumnType<
    ExchangeRequestStatus,
    ExchangeRequestStatus | undefined,
    ExchangeRequestStatus
  >;
  note: ColumnType<string | null, string | null | undefined, string | null>;
  sent_as: ColumnType<string | null, string | null | undefined, string | null>;
  file_name: ColumnType<string | null, string | null | undefined, string | null>;
  reviews: NullableJsonColumn<Extract<EligibilityCheck, { status: 'answered' }>['reviews']>;
  created_at: Timestamp;
};

type ClearinghouseConnectionsTable = {
  agency_id: string;
  vendor: ClearinghouseVendor;
  is_active: Generated<boolean>;
  sftp_host: string;
  sftp_port: number;
  sftp_host_key: string;
  sftp_username: string;
  sftp_secret: string;
  upload_path: string;
  download_paths: string[];
  claim_extension: string;
  eligibility_extension: string;
  claim_status_extension: string;
  after_download: AfterDownload;
  realtime_url: string | null;
  updated_at: Timestamp;
};

type ClearinghouseDownloadsTable = {
  id: Generated<string>;
  source: string;
  remote_path: string;
  size: number;
  modified_at: ColumnType<Date, Date | string, Date | string>;
  agency_id: string | null;
  run_id: string | null;
  note: ColumnType<string, string | undefined, string>;
  tried_at: ColumnType<Date, Date | string | undefined, Date | string>;
  created_at: Timestamp;
};

export type PayerFilesTable = {
  id: Generated<string>;
  agency_id: string;
  kind: InboundKind;
  file_name: string;
  digest: string;
  document: JsonColumn;
  control_number: string | null;
  item_count: ColumnType<number, number | undefined, number>;
  problem_count: ColumnType<number, number | undefined, number>;
  uploaded_by_id: string | null;
  run_id: string | null;
  source_key: string | null;
  envelope_rejection: string | null;
  created_at: Timestamp;
};

type PayerFileItemsTable = {
  id: Generated<string>;
  agency_id: string;
  file_id: string;
  position: number;
  reference: string;
  claim_id: string | null;
  outcome: PayerFileOutcome;
  message: ColumnType<string, string | undefined, string>;
  paid_cents: number | null;
  adjusted_cents: number | null;
};

export const IMPORT_SOURCES = ['upload', 'sftp', 'manual'] as const;

export type ImportSource = (typeof IMPORT_SOURCES)[number];

type ImportsTable = {
  id: Generated<string>;
  agency_id: string;
  run_id: string;
  source: ImportSource;
  file_name: string;
  file: JsonColumn;
  report_count: number | null;
  uploaded_by_id: string | null;
  created_at: Timestamp;
};

type ImportReportsTable = {
  id: Generated<string>;
  agency_id: string;
  import_id: string;
  position: number;
  number: GeneratedAlways<string>;
  pcr_number: string | null;
  report: JsonColumn;
  report_key: string;
  created_at: Timestamp;
};

type BillingProfilesTable = {
  agency_id: string;
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
  time_zone: string;
  is_production: Generated<boolean>;
  next_control_number: Generated<number>;
  updated_at: Timestamp;
};

export type PayersTable = {
  id: Generated<string>;
  agency_id: string;
  name: string;
  payer_code: string;
  claim_filing: ClaimFilingCode;
  filing_limit_days: ColumnType<number | null, number | null | undefined, number | null>;
  correction_method: ColumnType<
    CorrectionMethod | null,
    CorrectionMethod | null | undefined,
    CorrectionMethod | null
  >;
  appeal_days: ColumnType<number | null, number | null | undefined, number | null>;
  plan_type: ColumnType<PlanType | null, PlanType | null | undefined, PlanType | null>;
  embedding: ColumnType<string | null, string | null | undefined, string | null>;
  created_at: Timestamp;
  updated_at: Timestamp;
};

export const EMBEDDING_DIMENSIONS = 1024;

type PayerAliasesTable = {
  id: Generated<string>;
  agency_id: string;
  payer_id: string;
  alias: string;
  alias_key: string;
  created_at: Timestamp;
};

type PayerSuggestionsTable = {
  agency_id: string;
  name_key: string;
  directory_version: string;
  payer_id: string | null;
  created_at: Timestamp;
};

export type Database = {
  organizations: OrganizationsTable;
  agencies: AgenciesTable;
  users: UsersTable;
  roles: RolesTable;
  role_permissions: RolePermissionsTable;
  memberships: MembershipsTable;
  invitations: InvitationsTable;
  password_tokens: PasswordTokensTable;
  graphs: GraphsTable;
  graph_versions: GraphVersionsTable;
  workflow_runs: WorkflowRunsTable;
  workflow_run_steps: WorkflowRunStepsTable;
  workflow_run_graphs: WorkflowRunGraphsTable;
  data_tables: DataTablesTable;
  data_table_versions: DataTableVersionsTable;
  workflow_run_tables: WorkflowRunTablesTable;
  gnis_places: GnisPlacesTable;
  nemsis_elements: NemsisElementsTable;
  nemsis_codes: NemsisCodesTable;
  nemsis_pick_lists: NemsisPickListsTable;
  codes: CodesTable;
  cms_zip_localities: CmsZipLocalitiesTable;
  cms_zip4_localities: CmsZip4LocalitiesTable;
  cms_ambulance_fees: CmsAmbulanceFeesTable;
  cms_hospitals: CmsHospitalsTable;
  geonames_postal_codes: GeonamesPostalCodesTable;
  daily_numbers: DailyNumbersTable;
  signals: SignalsTable;
  schedule_runs: ScheduleRunsTable;
  tasks: TasksTable;
  patients: PatientsTable;
  fee_schedules: FeeSchedulesTable;
  imports: ImportsTable;
  import_reports: ImportReportsTable;
  claims: ClaimsTable;
  facilities: FacilitiesTable;
  facility_invoices: FacilityInvoicesTable;
  facility_invoice_claims: FacilityInvoiceClaimsTable;
  claim_runs: ClaimRunsTable;
  claim_lines: ClaimLinesTable;
  claim_coverages: ClaimCoveragesTable;
  claim_diagnoses: ClaimDiagnosesTable;
  claim_documents: ClaimDocumentsTable;
  claim_balances: ClaimBalancesView;
  claim_events: ClaimEventsTable;
  claim_event_adjustments: ClaimEventAdjustmentsTable;
  claim_event_remarks: ClaimEventRemarksTable;
  claim_event_lines: ClaimEventLinesTable;
  claim_event_line_adjustments: ClaimEventLineAdjustmentsTable;
  claim_batches: ClaimBatchesTable;
  claim_status_requests: ClaimStatusRequestsTable;
  eligibility_requests: EligibilityRequestsTable;
  payer_files: PayerFilesTable;
  clearinghouse_connections: ClearinghouseConnectionsTable;
  clearinghouse_downloads: ClearinghouseDownloadsTable;
  payer_file_items: PayerFileItemsTable;
  billing_profiles: BillingProfilesTable;
  payers: PayersTable;
  payer_aliases: PayerAliasesTable;
  payer_suggestions: PayerSuggestionsTable;

  notifications: NotificationsTable;
  notification_states: NotificationStatesTable;
};

export type Db = Kysely<Database>;

export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = ['completed', 'failed', 'cancelled'];

export const ACTIVE_RUN_STATUSES: readonly RunStatus[] = ['running', 'suspended', 'faulted'];
