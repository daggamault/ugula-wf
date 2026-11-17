import type { Api } from '../../shared/api.ts';
import type { Page } from '../../shared/url-state.ts';

export type Deposit = {
  id: string;
  trace_number: string;
  amount_cents: number;
  deposited_on: string;
  payer_name: string | null;
  note: string | null;
  payer_file_id: string | null;
  file_name: string | null;
  payment_cents: number | null;
  paid_on: string | null;
  created_by: string | null;
  created_at: string;
};

export type DepositInput = {
  traceNumber: string;
  amountCents: number;
  depositedOn: string;
  payerName: string | null;
  note: string | null;
};

export const createDepositsClient = (api: Api) => ({
  search: (query: string, signal?: AbortSignal) =>
    api.get<Page<Deposit>>(`/api/deposits?${query}`, signal),
  deposit: async (id: string, signal?: AbortSignal) =>
    (await api.get<{ deposit: Deposit }>(`/api/deposits/${encodeURIComponent(id)}`, signal))
      .deposit,
  record: (input: DepositInput) => api.post<{ id: string }>('/api/deposits', input)
});

export type DepositsClient = ReturnType<typeof createDepositsClient>;
