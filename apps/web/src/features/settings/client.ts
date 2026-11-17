import type { AfterDownload, ClearinghouseVendor } from '@ugula/billing';
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
  time_zone: string | null;
  is_production: boolean;
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
  isProduction: boolean;
};

export type ClearinghouseConnection = {
  vendor: ClearinghouseVendor;
  is_active: boolean;
  sftp_host: string;
  sftp_port: number;
  sftp_host_key: string;
  sftp_username: string;
  secret_set: boolean;
  upload_path: string;
  download_paths: string[];
  claim_extension: string;
  eligibility_extension: string;
  claim_status_extension: string;
  after_download: AfterDownload;
  realtime_url: string | null;
  last_polled_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
};

export type ConnectionInput = {
  vendor: ClearinghouseVendor;
  isActive: boolean;
  sftpHost: string;
  sftpPort: number;
  sftpHostKey: string;
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
  removeConnection: () => api.remove('/api/clearinghouse-connection')
});

export type SettingsClient = ReturnType<typeof createSettingsClient>;
