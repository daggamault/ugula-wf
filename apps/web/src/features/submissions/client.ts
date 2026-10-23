import type { Api } from '../../shared/api.ts';
import type { Page } from '../../shared/url-state.ts';

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

export const createSubmissionsClient = (api: Api) => ({
  pending: () => api.get<Pending>('/api/submissions/pending'),
  batches: (page: string) => api.get<Page<Batch>>(`/api/submissions/batches?${page}`),
  createBatch: async (claimIds: string[]) =>
    (await api.post<{ batch: Batch }>('/api/submissions/batches', { claimIds })).batch,
  markSubmitted: (claimId: string) => api.post('/api/submissions/manual', { claimId }),
  fileUrl: (batchId: string) => api.href(`/api/submissions/batches/${batchId}/file`)
});

export type SubmissionsClient = ReturnType<typeof createSubmissionsClient>;
