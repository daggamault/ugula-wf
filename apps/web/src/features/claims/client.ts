import type {
  ClaimEventKind,
  ClaimIssue,
  ClaimStatus,
  ClaimStep,
  ClaimTaskKey,
  DocumentKind,
  EligibilityStatus,
  FacilityStay,
  InboundKind,
  InsuredRelationship,
  MspAccident,
  PayerFileOutcome,
  PcsType,
  SignatureStatus,
  StayKind,
  TransportReason,
  TripType
} from '@ugula/billing';
import type { Api } from '../../shared/api.ts';
import type { Page } from '../../shared/url-state.ts';

export type { ClaimStatus };

export type ClaimSearch = {
  firstName: string;
  lastName: string;
  birthDate: string;
  number: string;
};

type ClaimQuery = Partial<ClaimSearch> & { status: 'open' | 'all'; patientId?: string };

export const claimSearchOf = (query: URLSearchParams): ClaimSearch => ({
  firstName: query.get('firstName') ?? '',
  lastName: query.get('lastName') ?? '',
  birthDate: query.get('birthDate') ?? '',
  number: query.get('number') ?? ''
});

export type Batch = {
  id: string;
  control_number: number;
  claim_count: number;
  total_cents: number;
  production: boolean;
  created_at: string;
  created_by_email: string | null;
};

const listQuery = (query: ClaimQuery, page: string) => {
  const filters = new URLSearchParams(
    Object.entries(query).flatMap(([k, v]) => (v?.trim() ? [[k, v.trim()]] : []))
  );
  return `${filters}&${page}`;
};

type CycleStatus = 'running' | 'suspended' | 'completed' | 'faulted' | 'failed' | 'cancelled';

type TaskKind = 'task' | 'fault';

export type ClaimSummary = {
  id: string;
  number: string;
  patient_number: string | null;
  pcr_number: string | null;
  encounter_number: string | null;
  level: string | null;
  total_cents: number;
  balance_cents: number;
  service_date: string | null;
  payers: string[];
  status: ClaimStatus;
  created_at: string;
  first_name: string | null;
  last_name: string | null;
  task_id: string | null;
  task_title: string | null;
  task_queue: string | null;
  task_kind: TaskKind | null;
  task_assignee_email: string | null;
  open_tasks: number;
};

export type ClaimTask = {
  id: string;
  title: string;
  subject: string | null;
  queue: string;
  kind: TaskKind;
  assignee_id: string | null;
  assignee_email: string | null;
  due_at: string | null;
  created_at: string;
};

export type ClaimLine = {
  position: number;
  code: string;
  units: number;
  unit_cents: number;
  total_cents: number;
};

export type ClaimCoverage = {
  id: string;
  position: number;
  payer: string;
  relationship: InsuredRelationship;
  insured_first_name: string | null;
  insured_last_name: string | null;
  payer_id: string | null;
  payer_code: string | null;
  member_id: string | null;
  group_id: string | null;
  eligibility: EligibilityStatus | null;
  eligibility_note: string | null;
  eligibility_checked_at: string | null;
  stay_kind: StayKind | null;
  stay_admitted_on: string | null;
  stay_discharged_on: string | null;
};

export type ClaimDocument = {
  id: string;
  kind: DocumentKind;
  file_name: string;
  signed_on: string | null;
  created_at: string;
  uploaded_by_email: string | null;
};

export type ClaimPayerFile = {
  id: string;
  kind: InboundKind;
  file_name: string;
  created_at: string;
  items: { outcome: PayerFileOutcome; message: string }[];
};

export type ClaimDetail = ClaimSummary & {
  trip_type: TripType | null;
  emergency: boolean | null;
  import_report_id: string | null;
  import_id: string | null;
  import_file_name: string | null;
  loaded_miles: string | null;
  birth_date: string | null;
  patient_id: string | null;
  cycle_run_id: string | null;
  cycle_status: CycleStatus | null;
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
  gender: string | null;
  address_line: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  signature: SignatureStatus;
  signature_note: string | null;
  pcs_on_file: boolean | null;
  pcs_signed_on: string | null;
  transport_reason: TransportReason | null;
  condition_codes: string[];
  prior_authorization: string | null;
  weight_kg: string | null;
  at_scene_at: string | null;
  left_scene_at: string | null;
  at_destination_at: string | null;
  patient_count: number | null;
  closest_facility_miles: string | null;
  abn_on_file: boolean | null;
  abn_signed_on: string | null;
  denial_expected: boolean | null;
  msp_employer_plan: boolean | null;
  msp_esrd: boolean | null;
  msp_disability: boolean | null;
  msp_accident: MspAccident | null;
  prior_authorization_expires_on: string | null;
  pcs_type: PcsType | null;
  round_trips: number | null;
  admission_date: string | null;
  facility_stay: FacilityStay | null;
  deceased: boolean;
  non_covered_miles: string | null;
  coverages: ClaimCoverage[];
  lines: ClaimLine[];
  diagnoses: string[];
  tasks: ClaimTask[];
  facility_id: string | null;
  facility_name: string | null;
};

export type ClaimEvent = {
  id: string;
  kind: ClaimEventKind;
  coverage_id: string | null;
  payer: string | null;
  paid_cents: number;
  adjusted_cents: number;
  paid_on: string | null;
  check_number: string | null;
  payer_claim_number: string | null;
  note: string;
  created_at: string;
  has_document: boolean;
  batch_id?: string | null;
  batch_number?: number | null;
  batch_sent_at?: string | null;
};

export type ClaimProgress = ClaimStep;

const claimPath = (id: string) => `/api/claims/${encodeURIComponent(id)}`;

export const createClaimsClient = (api: Api) => ({
  list: (query: ClaimQuery, page: string, signal?: AbortSignal) =>
    api.get<Page<ClaimSummary>>(`/api/claims?${listQuery(query, page)}`, signal),
  find: (id: string, signal?: AbortSignal) =>
    api.get<{
      claim: ClaimDetail;
      files: ClaimEvent[];
      payerFiles: ClaimPayerFile[];
      documents: ClaimDocument[];
      progress: ClaimProgress | null;
      issues: ClaimIssue[];
    }>(claimPath(id), signal),
  events: (id: string, page: string, signal?: AbortSignal) =>
    api.get<Page<ClaimEvent>>(`${claimPath(id)}/events?${page}`, signal),
  documentUrl: (claimId: string, eventId: string) =>
    api.href(`${claimPath(claimId)}/events/${encodeURIComponent(eventId)}/document`),
  restartCycle: (id: string) => api.post<{ runId: string }>(`${claimPath(id)}/restart-cycle`),
  startTask: (id: string, workflow: ClaimTaskKey) =>
    api.post<{ runId: string }>(`${claimPath(id)}/tasks`, { workflow }),
  runTask: async (runId: string) =>
    (await api.get<Page<{ id: string }>>(`/api/tasks?runId=${encodeURIComponent(runId)}`)).items[0]
      ?.id ?? null,
  claimDocumentUrl: (claimId: string, documentId: string) =>
    api.href(`${claimPath(claimId)}/documents/${encodeURIComponent(documentId)}`),
  eligibilityRequest: (claimId: string) =>
    api.post<{ name: string; file: string; payers: string[] }>('/api/submissions/eligibility', {
      claimId
    }),
  checkEligibility: (claimId: string) =>
    api.post<{ runId: string }>('/api/submissions/eligibility-checks', { claimId }),
  fileUrl: (batchId: string) =>
    api.href(`/api/submissions/batches/${encodeURIComponent(batchId)}/file`),
  encounterUrl: (reportId: string) =>
    api.href(`/api/imports/reports/${encodeURIComponent(reportId)}/xml`)
});

export type ClaimsClient = ReturnType<typeof createClaimsClient>;
