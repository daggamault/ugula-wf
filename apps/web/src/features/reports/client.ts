import type { Api } from '../../shared/api.ts';

export type DateRange = { from: string; to: string };

export type AgingRow = {
  payer: string | null;
  claims: number;
  balance_cents: number;
  current_cents: number;
  days_31_60_cents: number;
  days_61_90_cents: number;
  days_91_120_cents: number;
  over_120_cents: number;
};

export type MonthlyRow = {
  month: string;
  claims: number;
  charges_cents: number;
  paid_cents: number;
  adjusted_cents: number;
  open_balance_cents: number;
  unrecovered_cents: number;
};

export type HcpcsRow = {
  code: string;
  claims: number;
  units: string;
  charges_cents: number;
  average_unit_cents: number;
};

export type PayerRow = {
  payer: string;
  in_directory: boolean;
  claims: number;
  submitted: number;
  answered: number;
  paid_cents: number;
  adjusted_cents: number;
  average_days_to_response: number | null;
};

export type PatientPayments = { paid_cents: number; adjusted_cents: number };

const query = (range: DateRange) => `?from=${range.from}&to=${range.to}`;

export const createReportsClient = (api: Api) => ({
  aging: () => api.get<{ asOf: string; rows: AgingRow[] }>('/api/reports/aging'),
  monthly: (range: DateRange) =>
    api.get<{ range: DateRange; rows: MonthlyRow[] }>(`/api/reports/monthly${query(range)}`),
  hcpcs: (range: DateRange) =>
    api.get<{ range: DateRange; rows: HcpcsRow[] }>(`/api/reports/hcpcs${query(range)}`),
  payers: (range: DateRange) =>
    api.get<{ range: DateRange; rows: PayerRow[]; patient: PatientPayments }>(
      `/api/reports/payers${query(range)}`
    )
});

export type ReportsClient = ReturnType<typeof createReportsClient>;
