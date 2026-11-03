import {
  CLAIM_STATUSES,
  type ClaimEventKind,
  type ClaimStatus,
  type ClaimStep
} from '@ugula/billing';
import type { Api } from '../../shared/api.ts';
import type { Page } from '../../shared/url-state.ts';

export type { ClaimStatus };

export type ClaimFilter = ClaimStatus | 'open' | 'all';

export type Assignee = 'anyone' | 'me' | 'unassigned';

export type ClaimSearch = {
  status: ClaimFilter;
  firstName: string;
  lastName: string;
  birthDate: string;
  number: string;
  task: string;
  assignee: Assignee;
};

export type ClaimQuery = Partial<ClaimSearch> & { patientId?: string };

const FILTERS: readonly ClaimFilter[] = ['open', 'all', ...CLAIM_STATUSES];

const ASSIGNEES: readonly Assignee[] = ['anyone', 'me', 'unassigned'];

export const claimSearchOf = (query: URLSearchParams): ClaimSearch => ({
  status: FILTERS.find((f) => f === query.get('status')) ?? 'open',
  firstName: query.get('firstName') ?? '',
  lastName: query.get('lastName') ?? '',
  birthDate: query.get('birthDate') ?? '',
  number: query.get('number') ?? '',
  task: query.get('task') ?? '',
  assignee: ASSIGNEES.find((a) => a === query.get('assignee')) ?? 'anyone'
});

export type PendingClaim = {
  id: string;
  pcrNumber: string | null;
  patient: string;
  serviceDate: string | null;
  payer: string;
  totalCents: number;
  resubmission: boolean;
  issues: string[];
};

export type Pending = {
  issues: string[];
  claims: PendingClaim[];
};

export type Batch = {
  id: string;
  control_number: number;
  claim_count: number;
  total_cents: number;
  production: boolean;
  created_at: string;
  created_by_email: string | null;
};

export const listQuery = (query: ClaimQuery, page: string) => {
  const filters = new URLSearchParams(
    Object.entries(query).flatMap(([k, v]) =>
      v?.trim() && !(k === 'assignee' && v === 'anyone') ? [[k, v.trim()]] : []
    )
  );
  return `${filters}&${page}`;
};

export type CycleStatus =
  | 'running'
  | 'suspended'
  | 'completed'
  | 'faulted'
  | 'failed'
  | 'cancelled';

export type TaskKind = 'task' | 'fault';

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
  payer_id: string | null;
  payer_code: string | null;
  member_id: string | null;
  group_id: string | null;
};

export type ClaimDetail = ClaimSummary & {
  emergency: boolean | null;
  import_report_id: string | null;
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
  coverages: ClaimCoverage[];
  lines: ClaimLine[];
  diagnoses: string[];
  tasks: ClaimTask[];
};

export type AddressInput = {
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
};

export type ClaimEvent = {
  id: string;
  kind: ClaimEventKind;
  coverage_id: string | null;
  payer: string | null;
  paid_cents: number;
  adjusted_cents: number;
  note: string;
  created_at: string;
  has_document: boolean;
  batch_id?: string | null;
  batch_number?: number | null;
};

export type ClaimProgress = ClaimStep;

export type ClaimResponseInput = {
  requestId: string;
  coverageId: string | null;
  paidCents: number;
  adjustedCents: number;
  note: string;
};

export const createClaimsClient = (api: Api) => ({
  list: (query: ClaimQuery, page: string) =>
    api.get<Page<ClaimSummary>>(`/api/claims?${listQuery(query, page)}`),
  find: (id: string) =>
    api.get<{ claim: ClaimDetail; events: ClaimEvent[]; progress: ClaimProgress | null }>(
      `/api/claims/${id}`
    ),
  setPayers: (id: string, payers: string[]) =>
    api.put<{ payers: string[] }>(`/api/claims/${id}/payers`, { payers }),
  documentUrl: (claimId: string, eventId: string) =>
    api.href(`/api/claims/${claimId}/events/${eventId}/document`),
  saveBillingData: (id: string, data: BillingDataInput) =>
    api.put<{ status: string }>(`/api/claims/${id}/billing-data`, data),
  restartCycle: (id: string) => api.post<{ runId: string }>(`/api/claims/${id}/restart-cycle`),
  recordResponse: (id: string, response: ClaimResponseInput) =>
    api.post<{ balanceCents: number; duplicate: boolean }>(`/api/claims/${id}/responses`, response),
  pending: (claimId?: string) =>
    api.get<Pending>(`/api/submissions/pending${claimId ? `?claimId=${claimId}` : ''}`),
  createBatch: async (claimId: string) =>
    (await api.post<{ batch: Batch }>('/api/submissions/batches', { claimId })).batch,
  markSubmitted: (claimId: string) => api.post('/api/submissions/manual', { claimId }),
  fileUrl: (batchId: string) => api.href(`/api/submissions/batches/${batchId}/file`),
  encounterUrl: (reportId: string) => api.href(`/api/imports/reports/${reportId}/xml`)
});

export type ClaimsClient = ReturnType<typeof createClaimsClient>;
