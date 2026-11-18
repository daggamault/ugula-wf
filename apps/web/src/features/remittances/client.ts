import type { Adjustment, PaymentOutcome } from '@ugula/billing';
import type { Api } from '../../shared/api.ts';
import type { Page } from '../../shared/url-state.ts';

export type RemittanceSummary = {
  id: string;
  created_at: string;
  paid_on: string | null;
  payer_name: string | null;
  payer_code: string | null;
  trace_number: string | null;
  payment_method: string | null;
  total_cents: number;
  claim_paid_cents: number;
  provider_adjustment_cents: number;
  unmatched_count: number;
  is_balanced: boolean;
  reconciled_at: string | null;
  file_name: string;
  payment_count: number;
};

export type Remittance = RemittanceSummary & {
  reconcile_note: string | null;
  reconciled_by: string | null;
};

export type RemittancePayment = {
  id: string;
  claim_id: string | null;
  claim_number: string;
  coverage_position: number | null;
  outcome: PaymentOutcome;
  status_code: string;
  charge_cents: number;
  paid_cents: number;
  patient_cents: number;
  payer_claim_number: string | null;
  adjustments: Adjustment[];
  remarks: string[];
  first_name: string | null;
  last_name: string | null;
};

export const createRemittancesClient = (api: Api) => ({
  search: (query: string, signal?: AbortSignal) =>
    api.get<Page<RemittanceSummary>>(`/api/remittances?${query}`, signal),
  find: (id: string, signal?: AbortSignal) =>
    api.get<{ remittance: Remittance; payments: RemittancePayment[] }>(
      `/api/remittances/${encodeURIComponent(id)}`,
      signal
    )
});

export type RemittancesClient = ReturnType<typeof createRemittancesClient>;
