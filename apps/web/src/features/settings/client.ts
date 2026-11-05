import type {
  AfterDownload,
  ClearinghouseVendor,
  CorrectionMethod,
  PlanType
} from '@ugula/billing';
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

export type ClearinghouseConnection = {
  vendor: ClearinghouseVendor;
  enabled: boolean;
  sftp_host: string;
  sftp_port: number;
  sftp_username: string;
  secret_set: boolean;
  upload_path: string;
  download_paths: string[];
  claim_extension: string;
  eligibility_extension: string;
  claim_status_extension: string;
  after_download: AfterDownload;
  realtime_url: string | null;
};

export type ConnectionInput = {
  vendor: ClearinghouseVendor;
  enabled: boolean;
  sftpHost: string;
  sftpPort: number;
  sftpUsername: string;
  secret: string | null;
  uploadPath: string;
  downloadPaths: string[];
  claimExtension: string;
  eligibilityExtension: string;
  claimStatusExtension: string;
  afterDownload: AfterDownload;
  realtimeUrl: string | null;
};

export type PayerAlias = { id: string; alias: string };

export type Payer = {
  id: string;
  name: string;
  payer_id: string;
  claim_filing: string;
  filing_limit_days: number | null;
  correction_method: CorrectionMethod | null;
  appeal_days: number | null;
  plan_type: PlanType | null;
  aliases: PayerAlias[];
};

export type Facility = {
  id: string;
  name: string;
  address_line: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  phone: string | null;
  balance_cents: number;
};

export type FacilityInput = {
  name: string;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  phone: string | null;
};

export type PayerInput = {
  name: string;
  payerId: string;
  claimFiling: string;
  filingLimitDays: number | null;
  correctionMethod: CorrectionMethod | null;
  appealDays: number | null;
  planType: PlanType | null;
};

export const createSettingsClient = (api: Api) => ({
  profile: async () =>
    (await api.get<{ profile: BillingProfile | null }>('/api/billing-profile')).profile,
  saveProfile: (profile: BillingProfileInput) => api.put('/api/billing-profile', profile),
  connection: () =>
    api.get<{ connection: ClearinghouseConnection | null; canStoreSecrets: boolean }>(
      '/api/clearinghouse-connection'
    ),
  saveConnection: (connection: ConnectionInput) =>
    api.put('/api/clearinghouse-connection', connection),
  removeConnection: () => api.remove('/api/clearinghouse-connection'),
  searchPayers: (query: string, signal?: AbortSignal) =>
    api.get<Page<Payer>>(`/api/payers?${query}`, signal),
  payer: async (id: string, signal?: AbortSignal) =>
    (await api.get<{ payer: Payer }>(`/api/payers/${encodeURIComponent(id)}`, signal)).payer,
  savePayer: (payer: PayerInput) =>
    api.put<{ payer: Payer; linkedClaims: number }>('/api/payers', payer),
  removePayer: (id: string) => api.remove(`/api/payers/${encodeURIComponent(id)}`),
  searchFacilities: (query: string, signal?: AbortSignal) =>
    api.get<Page<Facility>>(`/api/facilities?${query}`, signal),
  facility: async (id: string, signal?: AbortSignal) =>
    (await api.get<{ facility: Facility }>(`/api/facilities/${encodeURIComponent(id)}`, signal))
      .facility,
  saveFacility: (id: string | null, facility: FacilityInput) =>
    id
      ? api.put<{ id: string }>(`/api/facilities/${encodeURIComponent(id)}`, facility)
      : api.post<{ id: string }>('/api/facilities', facility),
  removeFacility: (id: string) => api.remove(`/api/facilities/${encodeURIComponent(id)}`),
  forgetAlias: (payerId: string, aliasId: string) =>
    api.remove(`/api/payers/${encodeURIComponent(payerId)}/aliases/${encodeURIComponent(aliasId)}`)
});

export type SettingsClient = ReturnType<typeof createSettingsClient>;
