import type { ClaimEventKind, ClaimStep } from '@ugula/billing';
import type { Api } from '../../shared/api.ts';
import type { Page } from '../../shared/url-state.ts';

export type ClaimStatus = 'open' | 'paid' | 'written_off' | 'collections';

export type ClaimView = ClaimStatus | 'ready' | 'all';

export type ClaimQuery = { status: ClaimStatus | 'all'; q: string; patientId?: string };

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

const listQuery = ({ status, q, patientId }: ClaimQuery, page: string) => {
  const filters = new URLSearchParams({
    status,
    ...(q.trim() ? { q: q.trim() } : {}),
    ...(patientId ? { patientId } : {})
  });
  return `${filters}&${page}`;
};

export type CycleStatus =
  | 'running'
  | 'suspended'
  | 'completed'
  | 'faulted'
  | 'failed'
  | 'cancelled';

export type ClaimSummary = {
  id: string;
  pcr_number: string | null;
  level: string;
  total_cents: number;
  balance_cents: number;
  service_date: string | null;
  payers: string[];
  status: ClaimStatus;
  created_at: string;
  first_name: string;
  last_name: string;
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
  emergency: boolean;
  loaded_miles: string | null;
  birth_date: string;
  patient_id: string;
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
  batches: (page: string) => api.get<Page<Batch>>(`/api/submissions/batches?${page}`),
  createBatch: async (claimIds: string[]) =>
    (await api.post<{ batch: Batch }>('/api/submissions/batches', { claimIds })).batch,
  markSubmitted: (claimId: string) => api.post('/api/submissions/manual', { claimId }),
  fileUrl: (batchId: string) => api.href(`/api/submissions/batches/${batchId}/file`)
});

export type ClaimsClient = ReturnType<typeof createClaimsClient>;
