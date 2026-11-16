import type { CorrectionMethod, PlanType } from '@ugula/billing';
import type { Api } from '../../shared/api.ts';
import type { Page } from '../../shared/url-state.ts';

export type PayerAlias = { id: string; alias: string };

export type Payer = {
  id: string;
  name: string;
  payer_code: string;
  claim_filing: string;
  filing_limit_days: number | null;
  correction_method: CorrectionMethod | null;
  appeal_days: number | null;
  plan_type: PlanType | null;
  aliases: PayerAlias[];
};

export type PayerInput = {
  name: string;
  payerCode: string;
  claimFiling: string;
  filingLimitDays: number | null;
  correctionMethod: CorrectionMethod | null;
  appealDays: number | null;
  planType: PlanType | null;
};

export const createPayersClient = (api: Api) => ({
  search: (query: string, signal?: AbortSignal) =>
    api.get<Page<Payer>>(`/api/payers?${query}`, signal),
  payer: async (id: string, signal?: AbortSignal) =>
    (await api.get<{ payer: Payer }>(`/api/payers/${encodeURIComponent(id)}`, signal)).payer,
  save: (payer: PayerInput) =>
    api.put<{ payer: Payer; linkedClaims: number }>('/api/payers', payer),
  remove: (id: string) => api.remove(`/api/payers/${encodeURIComponent(id)}`),
  forgetAlias: (payerId: string, aliasId: string) =>
    api.remove(`/api/payers/${encodeURIComponent(payerId)}/aliases/${encodeURIComponent(aliasId)}`)
});

export type PayersClient = ReturnType<typeof createPayersClient>;
