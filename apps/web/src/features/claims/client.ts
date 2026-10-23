import type { ClaimEventKind, ClaimStep } from '@ugula/billing';
import type { Api } from '../../shared/api.ts';

export type ClaimStatus = 'open' | 'paid' | 'written_off' | 'collections';

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
  payers: string[];
  status: ClaimStatus;
  created_at: string;
  first_name: string;
  last_name: string;
};

export type ClaimLine = { code: string; units: number; unitCents: number; totalCents: number };

export type ClaimDetail = ClaimSummary & {
  emergency: boolean;
  loaded_miles: string | null;
  lines: ClaimLine[];
  birth_date: string;
  patient_id: string;
  cycle_run_id: string | null;
  cycle_status: CycleStatus | null;
  coverages: ClaimCoverage[];
  details: ClaimDetailsData;
  gender: string | null;
  address_line: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
};

export type ClaimCoverage = {
  payer: string;
  payerCode: string | null;
  memberId: string | null;
  groupId: string | null;
};

export type AddressInput = {
  addressLine: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
};

export type LocationInput = AddressInput & { name: string | null };

export type ClaimDetailsData = {
  serviceDate: string | null;
  pickup: LocationInput;
  destination: LocationInput;
  diagnoses: string[];
  originDestination: string | null;
};

export type BillingDataInput = ClaimDetailsData & {
  patient: AddressInput;
  coverages: { payer: string; memberId: string | null; groupId: string | null }[];
};

export type ClaimEvent = {
  id: string;
  kind: ClaimEventKind;
  payer: string | null;
  paid_cents: number;
  adjusted_cents: number;
  note: string;
  created_at: string;
  has_document: boolean;
};

export type ClaimProgress = ClaimStep;

export type ClaimResponseInput = {
  requestId: string;
  payer: string | null;
  paidCents: number;
  adjustedCents: number;
  note: string;
};

export const createClaimsClient = (api: Api) => ({
  list: async (status: ClaimStatus) =>
    (await api.get<{ claims: ClaimSummary[] }>(`/api/claims?status=${status}`)).claims,
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
    api.post<{ balanceCents: number; duplicate: boolean }>(`/api/claims/${id}/responses`, response)
});

export type ClaimsClient = ReturnType<typeof createClaimsClient>;
