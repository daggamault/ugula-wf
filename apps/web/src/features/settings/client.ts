import type { Api } from '../../shared/api.ts';

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
  production: boolean;
};

export type PayerAlias = { id: string; alias: string };

export type Payer = {
  id: string;
  name: string;
  payer_id: string;
  claim_filing: string;
  aliases: PayerAlias[];
};

export type PayerInput = { name: string; payerId: string; claimFiling: string };

export const createSettingsClient = (api: Api) => ({
  profile: async () =>
    (await api.get<{ profile: BillingProfile | null }>('/api/billing-profile')).profile,
  saveProfile: (profile: BillingProfileInput) => api.put('/api/billing-profile', profile),
  payers: async () => (await api.get<{ payers: Payer[] }>('/api/payers')).payers,
  savePayer: (payer: PayerInput) =>
    api.put<{ payer: Payer; linkedClaims: number }>('/api/payers', payer),
  removePayer: (id: string) => api.remove(`/api/payers/${id}`),
  forgetAlias: (payerId: string, aliasId: string) =>
    api.remove(`/api/payers/${payerId}/aliases/${aliasId}`)
});

export type SettingsClient = ReturnType<typeof createSettingsClient>;
