import type { Api } from '../../shared/api.ts';

export type ImportResult = {
  runId: string;
  file: { bucket: string; key: string; size: number; contentType: string };
};

export type ImportRunStatus =
  | 'running'
  | 'suspended'
  | 'completed'
  | 'faulted'
  | 'failed'
  | 'cancelled';

export type ImportSummary = {
  id: string;
  file_name: string;
  source: 'upload' | 'sftp' | 'manual';
  report_count: number | null;
  created_at: string;
  run_id: string;
  run_status: ImportRunStatus;
  uploaded_by_email: string | null;
  completed: number;
  waiting: number;
  stuck: number;
  held: number;
  processing: number;
  claims: number;
  charges_cents: number;
};

export const createImportsClient = (api: Api) => ({
  list: async () => (await api.get<{ imports: ImportSummary[] }>('/api/imports?limit=50')).imports,
  upload: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.upload<ImportResult>('/api/imports', form);
  }
});

export type ImportsClient = ReturnType<typeof createImportsClient>;
