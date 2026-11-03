import type { Api } from '../../shared/api.ts';
import type { Page } from '../../shared/url-state.ts';

export type Fee = {
  id: string;
  payer_id: string | null;
  payer: string | null;
  code: string;
  amount_cents: number;
  updated_at: string;
};

export type FeeInput = {
  payerId: string | null;
  code: string;
  amountCents: number;
};

export type DirectoryPayer = { id: string; name: string };

export const createFeesClient = (api: Api) => ({
  search: (query: string, signal?: AbortSignal) => api.get<Page<Fee>>(`/api/fees?${query}`, signal),
  fee: async (id: string, signal?: AbortSignal) =>
    (await api.get<{ fee: Fee }>(`/api/fees/${encodeURIComponent(id)}`, signal)).fee,
  payers: async (q: string, signal?: AbortSignal) =>
    (
      await api.get<{ payers: DirectoryPayer[] }>(
        `/api/payers/names${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`,
        signal
      )
    ).payers,
  save: async (fee: FeeInput) => (await api.put<{ fee: Fee }>('/api/fees', fee)).fee,
  remove: (id: string) => api.remove<{ status: string }>(`/api/fees/${encodeURIComponent(id)}`)
});

export type FeesClient = ReturnType<typeof createFeesClient>;
