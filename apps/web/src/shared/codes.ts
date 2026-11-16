import type { CodeSet } from '@ugula/billing';
import type { Api } from './api.ts';

export type Code = { code: string; description: string; is_billable: boolean };

export const createCodesClient = (api: Api) => {
  const find = async (set: CodeSet, params: Record<string, string>, signal?: AbortSignal) =>
    (
      await api.get<{ codes: Code[] }>(
        `/api/codes?${new URLSearchParams({ set, ...params })}`,
        signal
      )
    ).codes;
  return {
    search: (set: CodeSet, q: string, list: string | null, signal?: AbortSignal) =>
      find(set, { q, ...(list ? { list } : {}) }, signal),
    describe: async (set: CodeSet, codes: readonly string[], signal?: AbortSignal) =>
      codes.length ? find(set, { codes: codes.join(',') }, signal) : []
  };
};

export type CodesClient = ReturnType<typeof createCodesClient>;
