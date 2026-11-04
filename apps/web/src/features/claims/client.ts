import type {
  AdjustmentGroup,
  ClaimEventKind,
  ClaimIssue,
  ClaimStatus,
  ClaimStep,
  EligibilityStatus,
  InboundKind,
  InsuredRelationship,
  PayerFileOutcome,
  SignatureStatus,
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
  number: number;
  patient_number: number | null;
  pcr_number: string | null;
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
  coverages: ClaimCoverage[];
  lines: ClaimLine[];
  diagnoses: string[];
  tasks: ClaimTask[];
};

type AddressInput = {
  addressLine: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
};

export type LocationInput = AddressInput & { name: string | null };

export type BillingDataInput = {
  serviceDate: string | null;
  pickup: LocationInput;
  destination: LocationInput;
  diagnoses: string[];
  originDestination: string | null;
  patient: AddressInput;
  coverages: { id: string; memberId: string | null; groupId: string | null }[];
  documentation: {
    signature: SignatureStatus | null;
    pcsOnFile: boolean | null;
    pcsSignedOn: string | null;
    transportReason: TransportReason | null;
  } | null;
};

export type PayerInput = {
  name: string;
  relationship: InsuredRelationship;
  insuredFirstName: string | null;
  insuredLastName: string | null;
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

type AdjustmentInput = { group: AdjustmentGroup; reason: string; cents: number };

export type ClaimResponseInput = {
  requestId: string;
  kind: 'response' | 'refunded';
  coverageId: string | null;
  paidCents: number;
  adjustedCents: number;
  paidOn: string | null;
  checkNumber: string | null;
  payerClaimNumber: string | null;
  adjustments: AdjustmentInput[];
  note: string;
};

const claimPath = (id: string) => `/api/claims/${encodeURIComponent(id)}`;

export const createClaimsClient = (api: Api) => ({
  list: (query: ClaimQuery, page: string, signal?: AbortSignal) =>
    api.get<Page<ClaimSummary>>(`/api/claims?${listQuery(query, page)}`, signal),
  find: (id: string, signal?: AbortSignal) =>
    api.get<{
      claim: ClaimDetail;
      files: ClaimEvent[];
      payerFiles: ClaimPayerFile[];
      progress: ClaimProgress | null;
      issues: ClaimIssue[];
    }>(claimPath(id), signal),
  events: (id: string, page: string, signal?: AbortSignal) =>
    api.get<Page<ClaimEvent>>(`${claimPath(id)}/events?${page}`, signal),
  setPayers: (id: string, payers: readonly PayerInput[]) =>
    api.put<{ payers: PayerInput[] }>(`${claimPath(id)}/payers`, { payers }),
  documentUrl: (claimId: string, eventId: string) =>
    api.href(`${claimPath(claimId)}/events/${encodeURIComponent(eventId)}/document`),
  saveBillingData: (id: string, data: BillingDataInput) =>
    api.put<{ status: string }>(`${claimPath(id)}/billing-data`, data),
  restartCycle: (id: string) => api.post<{ runId: string }>(`${claimPath(id)}/restart-cycle`),
  recordResponse: (id: string, response: ClaimResponseInput) =>
    api.post<{ balanceCents: number; duplicate: boolean }>(`${claimPath(id)}/responses`, response),
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
