import type { Api } from '../../shared/api.ts';

export type DateRange = { from: string; to: string };

export type ReportOptions = { range: DateRange | null; group: string | null };

type ReportPageRequest = number | 'all';

export type Totals = Readonly<Record<string, number>>;

type ReportResult<R> = {
  asOf: string;
  range: DateRange | null;
  group: string | null;
  items: R[];
  total: number;
  page: number;
  pageSize: number;
  totals: Totals;
};

type PayerName = { name: string | null; in_directory: boolean };

export type AgingRow = PayerName & {
  claims: number;
  balance_cents: number;
  days_0_30_cents: number;
  days_31_60_cents: number;
  days_61_90_cents: number;
  days_91_120_cents: number;
  days_over_120_cents: number;
};

type Claim = {
  claim_number: string;
  pcr_number: string | null;
  first_name: string | null;
  last_name: string | null;
  service_date: string | null;
};

export type UnbilledRow = Claim & {
  status: string;
  queue: string | null;
  age_days: number;
  charges_cents: number;
};

export type MonthlyRow = {
  month: string;
  claims: number;
  charges_cents: number;
  payer_paid_cents: number;
  patient_paid_cents: number;
  adjusted_cents: number;
  written_off_cents: number;
  collections_cents: number;
  open_balance_cents: number;
  billed: number;
  bill_days: number;
};

export type ActivityRow = {
  month: string;
  claims_billed: number;
  charges_billed_cents: number;
  payer_paid_cents: number;
  patient_paid_cents: number;
  adjusted_cents: number;
  written_off_cents: number;
  collections_cents: number;
};

export type PaymentRow = Claim & {
  id: string;
  posted_at: string;
  payer: string | null;
  filing: string | null;
  kind: 'response' | 'refunded';
  paid_on: string | null;
  check_number: string | null;
  payer_claim_number: string | null;
  paid_cents: number;
  adjusted_cents: number;
  reason_codes: string;
  posted_by: string | null;
  note: string;
};

export type DenialRow = {
  payer: string | null;
  code: string;
  description: string | null;
  adjustments: number;
  denials: number;
  claims: number;
  amount_cents: number;
};

export type WriteOffRow = Claim & {
  id: string;
  closed_at: string;
  outcome: string;
  charges_cents: number;
  paid_cents: number;
  adjusted_cents: number;
  balance_cents: number;
};

export type PayerRow = PayerName & {
  billed: number;
  charges_cents: number;
  paid_cents: number;
  adjusted_cents: number;
  responses: number;
  denials: number;
  paid_claims: number;
  pay_days: number;
};

export type HcpcsRow = {
  code: string;
  description: string | null;
  claims: number;
  units: number;
  charges_cents: number;
};

export type LevelRow = {
  level: string;
  emergency: boolean;
  trips: number;
  miles: number;
  charges_cents: number;
};

export type WorkQueueRow = {
  name: string | null;
  open: number;
  unassigned: number;
  days_0_1: number;
  days_2_7: number;
  days_8_30: number;
  days_over_30: number;
  oldest_at: string;
};

export type ProductivityRow = {
  name: string;
  tasks: number;
  task_hours: number;
  submitted: number;
  posted: number;
};

export type ImportRow = {
  id: string;
  received_at: string;
  file_name: string;
  source: string;
  pcrs: number;
  billed: number;
  drafts: number;
  voided: number;
  revisions: number;
  no_claim: number;
  failed: number;
  charges_cents: number;
};

const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export const reportSearch = (
  { range, group }: ReportOptions,
  page: ReportPageRequest,
  tz: string
) => {
  const q = new URLSearchParams();
  if (range) {
    q.set('from', range.from);
    q.set('to', range.to);
  }
  if (group) q.set('group', group);
  q.set('tz', tz);
  if (page === 'all') q.set('all', 'true');
  else if (page > 1) q.set('page', String(page));
  return q.toString();
};

export const createReportsClient = (api: Api, timeZone: () => string = browserTimeZone) => ({
  run: <R>(id: string, options: ReportOptions, page: ReportPageRequest) =>
    api.get<ReportResult<R>>(
      `/api/reports/${encodeURIComponent(id)}?${reportSearch(options, page, timeZone())}`
    )
});

export type ReportsClient = ReturnType<typeof createReportsClient>;
