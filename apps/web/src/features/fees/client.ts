import type { Api } from '../../shared/api.ts';

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
  list: async () => (await api.get<{ fees: Fee[] }>('/api/fees')).fees,
  payers: async () => (await api.get<{ payers: DirectoryPayer[] }>('/api/payers')).payers,
  save: async (fee: FeeInput) => (await api.put<{ fee: Fee }>('/api/fees', fee)).fee,
  remove: (id: string) => api.remove<{ status: string }>(`/api/fees/${id}`)
});

export type FeesClient = ReturnType<typeof createFeesClient>;
