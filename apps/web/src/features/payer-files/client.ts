import type { InboundKind, PayerFileOutcome } from '@ugula/billing';
import type { Api } from '../../shared/api.ts';
import type { Page } from '../../shared/url-state.ts';

export type PayerFileSummary = {
  id: string;
  kind: InboundKind;
  file_name: string;
  control_number: string | null;
  item_count: number;
  problem_count: number;
  created_at: string;
  uploaded_by: string | null;
};

export type PayerFileItem = {
  position: number;
  reference: string;
  claim_id: string | null;
  claim_number: number | null;
  outcome: PayerFileOutcome;
  message: string;
  paid_cents: number | null;
  adjusted_cents: number | null;
};

type UploadedPayerFile = { runId: string; kind: InboundKind };

export const createPayerFilesClient = (api: Api) => ({
  list: (query: string, signal?: AbortSignal) =>
    api.get<Page<PayerFileSummary>>(`/api/payer-files?${query}`, signal),
  find: (id: string, signal?: AbortSignal) =>
    api.get<{ file: PayerFileSummary; items: PayerFileItem[] }>(
      `/api/payer-files/${encodeURIComponent(id)}`,
      signal
    ),
  fileHref: (id: string) => api.href(`/api/payer-files/${encodeURIComponent(id)}/file`),
  upload: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.upload<UploadedPayerFile>('/api/payer-files', form);
  }
});

export type PayerFilesClient = ReturnType<typeof createPayerFilesClient>;
