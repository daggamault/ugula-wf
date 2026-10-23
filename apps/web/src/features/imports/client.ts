import type { Api } from '../../shared/api.ts';

export type ImportResult = {
  runId: string;
  file: { bucket: string; key: string; size: number; contentType: string };
};

export const createImportsClient = (api: Api) => ({
  upload: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.upload<ImportResult>('/api/imports', form);
  }
});

export type ImportsClient = ReturnType<typeof createImportsClient>;
