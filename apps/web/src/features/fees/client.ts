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

type DirectoryPayer = { id: string; name: string };

export const createFeesClient = (api: Api) => ({
  search: (query: string) => api.get<Page<Fee>>(`/api/fees?${query}`),
  fee: async (id: string) =>
    (await api.get<{ fee: Fee }>(`/api/fees/${encodeURIComponent(id)}`)).fee,
  payers: async () => (await api.get<{ payers: DirectoryPayer[] }>('/api/payers/names')).payers,
  save: async (fee: FeeInput) => (await api.put<{ fee: Fee }>('/api/fees', fee)).fee,
  remove: (id: string) => api.remove<{ status: string }>(`/api/fees/${id}`)
});

export type FeesClient = ReturnType<typeof createFeesClient>;
