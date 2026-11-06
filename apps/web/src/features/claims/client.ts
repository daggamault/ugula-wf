import type {
  AdjustmentGroup,
  ClaimEventKind,
  ClaimIssue,
  ClaimStatus,
  ClaimStep,
  ClaimTaskKey,
  CodeDescriptions
} from '@ugula/billing';
import type { Api } from '../../shared/api.ts';
import type {
  ClaimDetail,
  ClaimDocument,
  ClaimPayerFile,
  ClaimSummary
} from '../../shared/claims/claim-detail.ts';
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

type EventAdjustment = {
  group: AdjustmentGroup;
  reason: string;
  cents: number;
  description: string | null;
};

type EventRemark = { code: string; description: string | null };

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
  adjustments?: EventAdjustment[];
  remarks?: EventRemark[];
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
      codes: CodeDescriptions;
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
