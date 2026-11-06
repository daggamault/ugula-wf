import { ADJUSTMENT_GROUPS, CLAIM_FILING_CODES } from '@ugula/billing';
import { described } from '../../shared/claims/code-text.tsx';
import { formatCents, formatDate, formatDateTime } from '../../shared/format.ts';
import { queueInfo, titleCase } from '../../shared/task-queues.ts';
import { emptyValue } from '../../shared/ui/empty-state.tsx';
import type {
  ActivityRow,
  AgingRow,
  DenialRow,
  HcpcsRow,
  ImportRow,
  LevelRow,
  MonthlyRow,
  PayerRow,
  PaymentRow,
  ProductivityRow,
  Totals,
  UnbilledRow,
  WorkQueueRow,
  WriteOffRow
} from './client.ts';
import { type CsvCell, dollars } from './csv.ts';

export type ReportColumn<R> = {
  label: string;
  isNumeric?: boolean;
  text: (row: R, totals: Totals) => string;
  csv: (row: R, totals: Totals) => CsvCell;
  total?: (totals: Totals) => string;
};

type NumericKey<R> = { [K in keyof R]-?: R[K] extends number ? K : never }[keyof R] & string;

type Read<R> = (key: NumericKey<R>) => number;

type Format = { text: (n: number) => string; csv: (n: number) => CsvCell };

const PATIENT = 'Patient';

const round1 = (n: number) => Math.round(n * 10) / 10;

const AS_MONEY: Format = { text: formatCents, csv: dollars };

const AS_COUNT: Format = { text: (n) => n.toLocaleString(), csv: (n) => n };

const AS_DECIMAL: Format = {
  text: (n) => n.toLocaleString(undefined, { maximumFractionDigits: 1 }),
  csv: round1
};

const AS_PERCENT: Format = { text: (n) => `${Math.round(n)}%`, csv: round1 };

const AS_MONEY_AVERAGE: Format = {
  text: (n) => formatCents(Math.round(n)),
  csv: (n) => dollars(Math.round(n))
};

const shown = (n: number | null, f: (n: number) => string) =>
  n === null || !Number.isFinite(n) ? emptyValue : f(n);

const derived = <R>(
  label: string,
  value: (read: Read<R>, totals: Totals) => number | null,
  format: Format,
  hasTotal = true
): ReportColumn<R> => {
  const ofRow =
    (r: R): Read<R> =>
    (k) =>
      Number(r[k]);
  const ofTotals =
    (t: Totals): Read<R> =>
    (k) =>
      t[k] ?? 0;
  return {
    label,
    isNumeric: true,
    text: (r, t) => shown(value(ofRow(r), t), format.text),
    csv: (r, t) => {
      const n = value(ofRow(r), t);
      return n === null || !Number.isFinite(n) ? null : format.csv(n);
    },
    ...(hasTotal ? { total: (t: Totals) => shown(value(ofTotals(t), t), format.text) } : {})
  };
};

const money = <R>(label: string, key: NumericKey<R>, hasTotal = true) =>
  derived<R>(label, (read) => read(key), AS_MONEY, hasTotal);

const count = <R>(label: string, key: NumericKey<R>, hasTotal = true) =>
  derived<R>(label, (read) => read(key), AS_COUNT, hasTotal);

const ratio = (part: number, whole: number) => (whole > 0 ? part / whole : null);

const percent = <R>(
  label: string,
  part: (read: Read<R>) => number,
  whole: (read: Read<R>) => number
) =>
  derived<R>(
    label,
    (read) => {
      const r = ratio(part(read), whole(read));
      return r === null ? null : r * 100;
    },
    AS_PERCENT
  );

const share = <R>(label: string, key: NumericKey<R>) =>
  derived<R>(
    label,
    (read, totals) => {
      const r = ratio(read(key), totals[key] ?? 0);
      return r === null ? null : r * 100;
    },
    AS_PERCENT
  );

const average = <R>(
  label: string,
  sum: NumericKey<R>,
  of: NumericKey<R>,
  format: Format = AS_DECIMAL,
  hasTotal = true
) => derived<R>(label, (read) => ratio(read(sum), read(of)), format, hasTotal);

const text = <R>(label: string, show: (row: R) => string | null): ReportColumn<R> => ({
  label,
  text: (r) => show(r) ?? emptyValue,
  csv: (r) => show(r)
});

export const filingLabel = (code: string | null) => {
  if (code === null) return PATIENT;
  if (code === '') return 'Not in Payer Directory';
  return Object.hasOwn(CLAIM_FILING_CODES, code)
    ? CLAIM_FILING_CODES[code as keyof typeof CLAIM_FILING_CODES]
    : code;
};

export const adjustmentGroupLabel = (code: string) => {
  const group = code.split('-')[0] ?? '';
  return Object.hasOwn(ADJUSTMENT_GROUPS, group)
    ? ADJUSTMENT_GROUPS[group as keyof typeof ADJUSTMENT_GROUPS]
    : null;
};

type PayerName = { name: string | null; in_directory: boolean };

const payerColumn = <R extends PayerName>(group: string | null): ReportColumn<R> =>
  group === 'class'
    ? text<R>('Financial Class', (r) => filingLabel(r.name))
    : {
        label: 'Payer',
        text: (r) =>
          r.name === null
            ? PATIENT
            : r.in_directory
              ? r.name
              : `${r.name} (not in payer directory)`,
        csv: (r) => r.name ?? PATIENT
      };

type ClaimRow = {
  claim_number: string;
  pcr_number: string | null;
  first_name: string | null;
  last_name: string | null;
  service_date: string | null;
};

const patientOf = (r: ClaimRow) =>
  r.last_name ? [r.last_name, r.first_name].filter(Boolean).join(', ') : null;

const claimColumns = <R extends ClaimRow>({ hasPcr = true } = {}): ReportColumn<R>[] => [
  text<R>('Claim', (r) => r.claim_number),
  ...(hasPcr ? [text<R>('PCR', (r) => r.pcr_number)] : []),
  text<R>('Patient', patientOf),
  text<R>('Date of Service', (r) => (r.service_date ? formatDate(r.service_date) : null))
];

const monthLabel = new Intl.DateTimeFormat(undefined, {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC'
});

export const formatMonth = (month: string) => monthLabel.format(new Date(`${month}-01T00:00:00Z`));

const monthColumn = <R extends { month: string }>(label: string): ReportColumn<R> => ({
  label,
  text: (r) => formatMonth(r.month),
  csv: (r) => r.month
});

const AGING_BUCKETS = [
  ['days_0_30_cents', '0–30 Days'],
  ['days_31_60_cents', '31–60 Days'],
  ['days_61_90_cents', '61–90 Days'],
  ['days_91_120_cents', '91–120 Days'],
  ['days_over_120_cents', 'Over 120 Days']
] as const;

export const agingColumns = (group: string | null): ReportColumn<AgingRow>[] => [
  { ...payerColumn<AgingRow>(group), ...(group === 'class' ? {} : { label: 'Owed By' }) },
  count('Claims', 'claims'),
  ...AGING_BUCKETS.map(([key, label]) => money<AgingRow>(label, key)),
  money('Balance', 'balance_cents')
];

export const UNBILLED_COLUMNS: readonly ReportColumn<UnbilledRow>[] = [
  ...claimColumns<UnbilledRow>(),
  text('Status', (r) => titleCase(r.status)),
  text('Waiting On', (r) => (r.queue ? queueInfo(r.queue).label : null)),
  count('Days Old', 'age_days', false),
  money('Charges', 'charges_cents')
];

const paidOf = (read: Read<MonthlyRow>) => read('payer_paid_cents') + read('patient_paid_cents');

export const MONTHLY_COLUMNS: readonly ReportColumn<MonthlyRow>[] = [
  monthColumn('Month of Service'),
  count('Claims', 'claims'),
  money('Charges', 'charges_cents'),
  money('Payer Paid', 'payer_paid_cents'),
  money('Patient Paid', 'patient_paid_cents'),
  money('Contractual Adjustments', 'adjusted_cents'),
  money('Written Off', 'written_off_cents'),
  money('Sent to Collections', 'collections_cents'),
  money('Open Balance', 'open_balance_cents'),
  percent('Net Collection Rate', paidOf, (read) => read('charges_cents') - read('adjusted_cents')),
  average('Days to Bill', 'bill_days', 'billed')
];

export const ACTIVITY_COLUMNS: readonly ReportColumn<ActivityRow>[] = [
  monthColumn('Month'),
  count('Claims Billed', 'claims_billed'),
  money('Charges Billed', 'charges_billed_cents'),
  money('Payer Payments', 'payer_paid_cents'),
  money('Patient Payments', 'patient_paid_cents'),
  money('Contractual Adjustments', 'adjusted_cents'),
  money('Written Off', 'written_off_cents'),
  money('Sent to Collections', 'collections_cents')
];

export const PAYMENT_COLUMNS: readonly ReportColumn<PaymentRow>[] = [
  text('Posted', (r) => formatDateTime(r.posted_at)),
  text('Paid On', (r) => (r.paid_on ? formatDate(r.paid_on) : null)),
  ...claimColumns<PaymentRow>({ hasPcr: false }),
  text('Paid By', (r) => r.payer ?? PATIENT),
  text('Financial Class', (r) => (r.payer === null ? null : filingLabel(r.filing ?? ''))),
  text('Type', (r) => (r.kind === 'refunded' ? 'Refund' : 'Payment')),
  text('Check or EFT', (r) => r.check_number),
  text('Payer Claim Number', (r) => r.payer_claim_number),
  money('Paid', 'paid_cents'),
  money('Adjusted', 'adjusted_cents'),
  text('Adjustment Reasons', (r) => r.reason_codes || null),
  text('Posted By', (r) => r.posted_by),
  text('Note', (r) => r.note || null)
];

export const denialColumns = (group: string | null): ReportColumn<DenialRow>[] => [
  ...(group === 'reason' ? [] : [text<DenialRow>('Payer', (r) => r.payer ?? PATIENT)]),
  text('Reason', (r) => described(r.description, r.code)),
  text('Group', (r) => adjustmentGroupLabel(r.code)),
  count('Adjustments', 'adjustments'),
  count('Denials', 'denials'),
  count('Claims', 'claims', false),
  money('Amount', 'amount_cents')
];

const OUTCOMES: Readonly<Record<string, string>> = {
  written_off: 'Written Off',
  collections: 'Sent to Collections'
};

export const WRITE_OFF_COLUMNS: readonly ReportColumn<WriteOffRow>[] = [
  text('Closed', (r) => formatDateTime(r.closed_at)),
  ...claimColumns<WriteOffRow>(),
  text('Outcome', (r) => OUTCOMES[r.outcome] ?? titleCase(r.outcome)),
  money('Charges', 'charges_cents'),
  money('Paid', 'paid_cents'),
  money('Adjusted', 'adjusted_cents'),
  money('Amount Closed', 'balance_cents')
];

export const payerColumns = (group: string | null): ReportColumn<PayerRow>[] => [
  payerColumn<PayerRow>(group),
  count('Claims Billed', 'billed'),
  money('Charges Billed', 'charges_cents'),
  money('Paid', 'paid_cents'),
  percent(
    'Paid of Charges',
    (read) => read('paid_cents'),
    (read) => read('charges_cents')
  ),
  money('Adjusted', 'adjusted_cents'),
  count('Responses', 'responses'),
  count('Denials', 'denials'),
  percent(
    'Denial Rate',
    (read) => read('denials'),
    (read) => read('responses')
  ),
  average('Days to Pay', 'pay_days', 'paid_claims')
];

export const HCPCS_COLUMNS: readonly ReportColumn<HcpcsRow>[] = [
  text('Service', (r) => described(r.description, r.code)),
  count('Claims', 'claims', false),
  derived('Units', (read) => read('units'), AS_DECIMAL, false),
  average('Average Price', 'charges_cents', 'units', AS_MONEY_AVERAGE, false),
  money('Charges', 'charges_cents'),
  share('Share of Charges', 'charges_cents')
];

export const LEVEL_COLUMNS: readonly ReportColumn<LevelRow>[] = [
  text('Level of Service', (r) => `${r.level} ${r.emergency ? 'Emergency' : 'Non-Emergency'}`),
  count('Trips', 'trips'),
  share('Share of Trips', 'trips'),
  derived('Loaded Miles', (read) => read('miles'), AS_DECIMAL),
  average('Miles per Trip', 'miles', 'trips'),
  money('Charges', 'charges_cents'),
  average('Charges per Trip', 'charges_cents', 'trips', AS_MONEY_AVERAGE)
];

const TASK_AGES = [
  ['days_0_1', '0–1 Days'],
  ['days_2_7', '2–7 Days'],
  ['days_8_30', '8–30 Days'],
  ['days_over_30', 'Over 30 Days']
] as const;

export const workQueueColumns = (group: string | null): ReportColumn<WorkQueueRow>[] => [
  group === 'assignee'
    ? text<WorkQueueRow>('Assignee', (r) => r.name ?? 'Unassigned')
    : text<WorkQueueRow>('Task Type', (r) => (r.name === null ? null : queueInfo(r.name).label)),
  count('Open', 'open'),
  ...(group === 'assignee' ? [] : [count<WorkQueueRow>('Unassigned', 'unassigned')]),
  ...TASK_AGES.map(([key, label]) => count<WorkQueueRow>(label, key)),
  text('Oldest', (r) => formatDateTime(r.oldest_at))
];

export const PRODUCTIVITY_COLUMNS: readonly ReportColumn<ProductivityRow>[] = [
  text('Biller', (r) => r.name),
  count('Tasks Completed', 'tasks'),
  average('Hours per Task', 'task_hours', 'tasks'),
  count('Submissions', 'submitted'),
  count('Payments Posted', 'posted')
];

export const IMPORT_COLUMNS: readonly ReportColumn<ImportRow>[] = [
  text('Received', (r) => formatDateTime(r.received_at)),
  text('File', (r) => r.file_name),
  text('Source', (r) => titleCase(r.source)),
  count('PCRs', 'pcrs'),
  count('Billed', 'billed'),
  count('In Draft', 'drafts'),
  count('Voided', 'voided'),
  count('Revisions', 'revisions'),
  count('Without Claim', 'no_claim'),
  count('Stuck or Failed', 'failed'),
  money('Charges', 'charges_cents')
];

export const csvRows = <R>(
  columns: readonly ReportColumn<R>[],
  rows: readonly R[],
  totals: Totals
): CsvCell[][] => [
  columns.map((c) => c.label),
  ...rows.map((r) => columns.map((c) => c.csv(r, totals)))
];

export const totalsOf = <R>(columns: readonly ReportColumn<R>[], totals: Totals) =>
  columns.some((c) => c.total)
    ? columns.map((c, i) => (i === 0 ? 'Total' : (c.total?.(totals) ?? '')))
    : null;
