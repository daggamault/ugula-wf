import type { Api } from '../../shared/api.ts';

export type ReportRemittance = {
  id: string;
  paid_on: string;
  payer_name: string | null;
  trace_number: string | null;
  payment_method: string | null;
  total_cents: number;
  claim_paid_cents: number;
  provider_adjustment_cents: number;
  unmatched_count: number;
  is_balanced: boolean;
  reconciled_at: string | null;
  payment_count: number;
};

export type UnmatchedPayment = {
  id: string;
  paid_on: string;
  payer_name: string | null;
  trace_number: string | null;
  claim_number: string;
  charge_cents: number;
  paid_cents: number;
  patient_cents: number;
  payer_claim_number: string | null;
};

export type RemittanceReport = {
  period: { from: string; to: string; payer?: string };
  totals: {
    remittances: number;
    totalCents: number;
    claimPaidCents: number;
    providerAdjustmentCents: number;
    unbalanced: number;
    unmatched: number;
    open: number;
  };
  remittances: ReportRemittance[];
  unmatched: UnmatchedPayment[];
  truncated: boolean;
};

export const REPORT_FIELDS = ['from', 'to', 'payer'] as const;

export const reportQuery = (query: URLSearchParams) =>
  new URLSearchParams(
    REPORT_FIELDS.flatMap((k) => (query.get(k)?.trim() ? [[k, query.get(k)?.trim() ?? '']] : []))
  ).toString();

export const createReportsClient = (api: Api) => ({
  remittances: (query: string, signal?: AbortSignal) =>
    api.get<RemittanceReport>(`/api/reports/remittances?${query}`, signal)
});

export type ReportsClient = ReturnType<typeof createReportsClient>;
