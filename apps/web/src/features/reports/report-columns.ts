import { HCPCS_LABELS } from '@ugula/billing';
import { formatCents } from '../../shared/format.ts';
import { emptyValue } from '../../shared/ui/empty-state.tsx';
import type { AgingRow, HcpcsRow, MonthlyRow, PatientPayments, PayerRow } from './client.ts';
import { type CsvCell, dollars } from './csv.ts';

export type ReportColumn<R> = {
  label: string;
  isNumeric?: boolean;
  text: (row: R) => string;
  csv: (row: R) => CsvCell;
  total?: (rows: readonly R[]) => string;
};

const PATIENT = 'Patient';

const sum = <T>(rows: readonly T[], pick: (row: T) => number) =>
  rows.reduce((total, row) => total + pick(row), 0);

export const percentOf = (part: number, whole: number) =>
  whole > 0 ? `${Math.round((part / whole) * 100)}%` : emptyValue;

const monthLabel = new Intl.DateTimeFormat(undefined, {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC'
});

export const formatMonth = (month: string) => monthLabel.format(new Date(`${month}-01T00:00:00Z`));

const count = <R>(
  label: string,
  pick: (row: R) => number | null,
  totals = true
): ReportColumn<R> => ({
  label,
  isNumeric: true,
  text: (r) => pick(r)?.toLocaleString() ?? emptyValue,
  csv: (r) => pick(r),
  ...(totals
    ? { total: (rows: readonly R[]) => sum(rows, (r) => pick(r) ?? 0).toLocaleString() }
    : {})
});

const money = <R>(
  label: string,
  pick: (row: R) => number | null,
  totals = true
): ReportColumn<R> => ({
  label,
  isNumeric: true,
  text: (r) => {
    const cents = pick(r);
    return cents === null ? emptyValue : formatCents(cents);
  },
  csv: (r) => {
    const cents = pick(r);
    return cents === null ? null : dollars(cents);
  },
  ...(totals ? { total: (rows: readonly R[]) => formatCents(sum(rows, (r) => pick(r) ?? 0)) } : {})
});

const AGING_BUCKETS = [
  ['current_cents', '0–30'],
  ['days_31_60_cents', '31–60'],
  ['days_61_90_cents', '61–90'],
  ['days_91_120_cents', '91–120'],
  ['over_120_cents', '120+']
] as const satisfies readonly (readonly [Exclude<keyof AgingRow, 'payer' | 'claims'>, string])[];

export const AGING_COLUMNS: readonly ReportColumn<AgingRow>[] = [
  { label: 'Owed By', text: (r) => r.payer ?? PATIENT, csv: (r) => r.payer ?? PATIENT },
  count('Claims', (r) => r.claims),
  ...AGING_BUCKETS.map(([key, label]) => money<AgingRow>(label, (r) => r[key])),
  money('Balance', (r) => r.balance_cents)
];

export const MONTHLY_COLUMNS: readonly ReportColumn<MonthlyRow>[] = [
  { label: 'Month of Service', text: (r) => formatMonth(r.month), csv: (r) => r.month },
  count('Claims', (r) => r.claims),
  money('Charges', (r) => r.charges_cents),
  money('Paid', (r) => r.paid_cents),
  money('Adjusted', (r) => r.adjusted_cents),
  {
    label: 'Collected %',
    isNumeric: true,
    text: (r) => percentOf(r.paid_cents, r.charges_cents),
    csv: (r) => percentOf(r.paid_cents, r.charges_cents),
    total: (rows) =>
      percentOf(
        sum(rows, (r) => r.paid_cents),
        sum(rows, (r) => r.charges_cents)
      )
  },
  money('Open Balance', (r) => r.open_balance_cents),
  money('Written Off / Collections', (r) => r.unrecovered_cents)
];

export type PayerLine = {
  payer: string;
  inDirectory: boolean;
  claims: number | null;
  submitted: number | null;
  answered: number | null;
  paidCents: number;
  adjustedCents: number;
  days: number | null;
};

export const payerLines = (rows: readonly PayerRow[], patient: PatientPayments): PayerLine[] => [
  ...rows.map((r) => ({
    payer: r.payer,
    inDirectory: r.in_directory,
    claims: r.claims,
    submitted: r.submitted,
    answered: r.answered,
    paidCents: r.paid_cents,
    adjustedCents: r.adjusted_cents,
    days: r.average_days_to_response
  })),
  {
    payer: PATIENT,
    inDirectory: true,
    claims: null,
    submitted: null,
    answered: null,
    paidCents: patient.paid_cents,
    adjustedCents: patient.adjusted_cents,
    days: null
  }
];

export const PAYER_COLUMNS: readonly ReportColumn<PayerLine>[] = [
  {
    label: 'Payer',
    text: (r) => (r.inDirectory ? r.payer : `${r.payer} (not in payer directory)`),
    csv: (r) => r.payer
  },
  count('Claims', (r) => r.claims, false),
  count('Submitted', (r) => r.submitted, false),
  count('Answered', (r) => r.answered, false),
  money('Paid', (r) => r.paidCents),
  money('Adjusted', (r) => r.adjustedCents),
  {
    label: 'Days to Respond',
    isNumeric: true,
    text: (r) => (r.days === null ? emptyValue : `${r.days} days`),
    csv: (r) => r.days
  }
];

export const HCPCS_COLUMNS: readonly ReportColumn<HcpcsRow>[] = [
  { label: 'HCPCS', text: (r) => r.code, csv: (r) => r.code },
  {
    label: 'Service',
    text: (r) => HCPCS_LABELS[r.code] ?? emptyValue,
    csv: (r) => HCPCS_LABELS[r.code] ?? null
  },
  count('Claims', (r) => r.claims, false),
  count('Units', (r) => Number(r.units), false),
  money('Average Price', (r) => r.average_unit_cents, false),
  money('Charges', (r) => r.charges_cents)
];

export const csvRows = <R>(
  columns: readonly ReportColumn<R>[],
  rows: readonly R[]
): CsvCell[][] => [columns.map((c) => c.label), ...rows.map((r) => columns.map((c) => c.csv(r)))];

export const totalsOf = <R>(columns: readonly ReportColumn<R>[], rows: readonly R[]) =>
  columns.some((c) => c.total)
    ? columns.map((c, i) => (i === 0 ? 'Total' : (c.total?.(rows) ?? '')))
    : null;
