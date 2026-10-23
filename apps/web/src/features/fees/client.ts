import type { Api } from '../../shared/api.ts';

export type Fee = {
  id: string;
  payer: string | null;
  code: string;
  amount_cents: number;
  updated_at: string;
};

export type FeeInput = {
  payer: string | null;
  code: string;
  amountCents: number;
};

export const createFeesClient = (api: Api) => ({
  list: async () => (await api.get<{ fees: Fee[] }>('/api/fees')).fees,
  save: async (fee: FeeInput) => (await api.put<{ fee: Fee }>('/api/fees', fee)).fee,
  remove: (id: string) => api.remove<{ status: string }>(`/api/fees/${id}`)
});

export type FeesClient = ReturnType<typeof createFeesClient>;
