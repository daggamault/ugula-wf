import type { Api } from '../../shared/api.ts';
import type { Page } from '../../shared/url-state.ts';

export type BillingProfile = {
  organization_name: string;
  npi: string;
  tax_id: string;
  address_line: string;
  city: string;
  state: string;
  postal_code: string;
  phone: string;
  submitter_id: string | null;
  receiver_id: string | null;
  receiver_name: string | null;
  time_zone: string | null;
  production: boolean;
};

export type BillingProfileInput = {
  organizationName: string;
  npi: string;
  taxId: string;
  addressLine: string;
  city: string;
  state: string;
  postalCode: string;
  phone: string;
  submitterId: string | null;
  receiverId: string | null;
  receiverName: string | null;
  timeZone: string;
  production: boolean;
};

export type PayerAlias = { id: string; alias: string };

export type Payer = {
  id: string;
  name: string;
  payer_id: string;
  claim_filing: string;
  filing_limit_days: number | null;
  aliases: PayerAlias[];
};

export type PayerInput = {
  name: string;
  payerId: string;
  claimFiling: string;
  filingLimitDays: number | null;
};

export const createSettingsClient = (api: Api) => ({
  profile: async () =>
    (await api.get<{ profile: BillingProfile | null }>('/api/billing-profile')).profile,
  saveProfile: (profile: BillingProfileInput) => api.put('/api/billing-profile', profile),
  searchPayers: (query: string, signal?: AbortSignal) =>
    api.get<Page<Payer>>(`/api/payers?${query}`, signal),
  payer: async (id: string, signal?: AbortSignal) =>
    (await api.get<{ payer: Payer }>(`/api/payers/${encodeURIComponent(id)}`, signal)).payer,
  savePayer: (payer: PayerInput) =>
    api.put<{ payer: Payer; linkedClaims: number }>('/api/payers', payer),
  removePayer: (id: string) => api.remove(`/api/payers/${encodeURIComponent(id)}`),
  forgetAlias: (payerId: string, aliasId: string) =>
    api.remove(`/api/payers/${encodeURIComponent(payerId)}/aliases/${encodeURIComponent(aliasId)}`)
});

export type SettingsClient = ReturnType<typeof createSettingsClient>;
