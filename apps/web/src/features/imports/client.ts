import type { ClaimStatus } from '@ugula/billing';
import type { Api } from '../../shared/api.ts';
import type { RunStatus } from '../../shared/ui/run-status-badge.tsx';
import type { Page } from '../../shared/url-state.ts';

type ImportResult = {
  importId: string;
  runIds: string[];
  file: { bucket: string; key: string; size: number; contentType: string };
};

export type ReportOutcome = 'created' | 'revised' | 'unchanged';

export type ImportSummary = {
  id: string;
  file_name: string;
  source: 'upload' | 'sftp' | 'manual';
  report_count: number | null;
  created_at: string;
  run_id: string | null;
  run_status: RunStatus | null;
  uploaded_by_email: string | null;
  created: number;
  revised: number;
  unchanged: number;
  claims: number;
  charges_cents: number;
};

export type ImportReport = {
  id: string;
  position: number;
  number: string;
  pcr_number: string | null;
  outcome: ReportOutcome | null;
  encounter_number: string | null;
  encounter_revision: number | null;
  claim_id: string | null;
  claim_status: ClaimStatus | null;
  total_cents: number | null;
  first_name: string | null;
  last_name: string | null;
};

export const createImportsClient = (api: Api) => ({
  find: async (id: string, signal?: AbortSignal) =>
    (await api.get<{ import: ImportSummary }>(`/api/imports/${encodeURIComponent(id)}`, signal))
      .import,
  reports: (id: string, page: string, signal?: AbortSignal) =>
    api.get<Page<ImportReport>>(`/api/imports/${encodeURIComponent(id)}/reports?${page}`, signal),
  list: (query: string, signal?: AbortSignal) =>
    api.get<Page<ImportSummary>>(`/api/imports?${query}`, signal),
  upload: (file: File, agencyId: string | null) => {
    const form = new FormData();
    form.append('file', file);
    return api.upload<ImportResult>('/api/imports', form, agencyId);
  }
});

export type ImportsClient = ReturnType<typeof createImportsClient>;
