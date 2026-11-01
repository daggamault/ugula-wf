import { HCPCS_LABELS } from '@ugula/billing';
import { formatCents } from '../../shared/format.ts';
import { Badge } from '../../shared/ui/badge.tsx';
import { emptyValue } from '../../shared/ui/empty-state.tsx';
import {
  Table,
  TableCell,
  type TableColumn,
  TableRow,
  type TableSorting,
  TableTotalRow
} from '../../shared/ui/table.tsx';
import type { SortValue } from '../../shared/url-state.ts';
import type { AgingRow, HcpcsRow, MonthlyRow, PatientPayments, PayerRow } from './client.ts';
import { type CsvCell, dollars } from './csv.ts';

const PATIENT = 'Patient';

const sum = <T,>(rows: readonly T[], pick: (row: T) => number) =>
  rows.reduce((total, row) => total + pick(row), 0);

export const percentOf = (part: number, whole: number) =>
  whole > 0 ? `${Math.round((part / whole) * 100)}%` : emptyValue;

const monthLabel = new Intl.DateTimeFormat(undefined, {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC'
});

export const formatMonth = (month: string) => monthLabel.format(new Date(`${month}-01T00:00:00Z`));

const money = (cents: number) => <TableCell kind="numeric">{formatCents(cents)}</TableCell>;

type AgingAmount = Exclude<keyof AgingRow, 'payer' | 'claims'>;

const AGING_BUCKETS = [
  ['current_cents', '0–30 days'],
  ['days_31_60_cents', '31–60'],
  ['days_61_90_cents', '61–90'],
  ['days_91_120_cents', '91–120'],
  ['over_120_cents', '120+']
] as const satisfies readonly (readonly [AgingAmount, string])[];

const numeric = (label: string, sort?: string): TableColumn => ({
  label,
  isNumeric: true,
  ...(sort ? { sort } : {})
});

export type ResultTableProps<T> = {
  rows: readonly T[];
  all: readonly T[];
  sorting?: TableSorting | undefined;
};

const sortingOf = (sorting: TableSorting | undefined) => (sorting ? { sorting } : {});

export const AGING_VALUES: Readonly<Record<string, (r: AgingRow) => SortValue>> = {
  owedBy: (r) => r.payer ?? PATIENT,
  claims: (r) => r.claims,
  ...Object.fromEntries(AGING_BUCKETS.map(([key]) => [key, (r: AgingRow) => r[key]])),
  balance: (r) => r.balance_cents
};

export const AgingTable = ({ rows, all, sorting }: ResultTableProps<AgingRow>) => (
  <Table
    label="Accounts receivable aging"
    {...sortingOf(sorting)}
    head={[
      { label: 'Owed by', sort: 'owedBy' },
      numeric('Claims', 'claims'),
      ...AGING_BUCKETS.map(([key, label]) => numeric(label, key)),
      numeric('Balance', 'balance')
    ]}
  >
    {rows.map((r) => (
      <TableRow key={r.payer ?? PATIENT}>
        <TableCell>
          <span className="font-medium">{r.payer ?? PATIENT}</span>
        </TableCell>
        <TableCell kind="numeric">{r.claims}</TableCell>
        {AGING_BUCKETS.map(([key]) => (
          <TableCell key={key} kind="numeric" isMuted={!r[key]}>
            {formatCents(r[key])}
          </TableCell>
        ))}
        <TableCell kind="numeric">
          <span className="font-semibold">{formatCents(r.balance_cents)}</span>
        </TableCell>
      </TableRow>
    ))}
    <TableTotalRow>
      <TableCell>Total</TableCell>
      <TableCell kind="numeric">{sum(all, (r) => r.claims)}</TableCell>
      {AGING_BUCKETS.map(([key]) => (
        <TableCell key={key} kind="numeric">
          {formatCents(sum(all, (r) => r[key]))}
        </TableCell>
      ))}
      {money(sum(all, (r) => r.balance_cents))}
    </TableTotalRow>
  </Table>
);

export const agingCsv = (rows: readonly AgingRow[]): CsvCell[][] => [
  ['Owed by', 'Claims', ...AGING_BUCKETS.map(([, label]) => label), 'Balance'],
  ...rows.map((r) => [
    r.payer ?? PATIENT,
    r.claims,
    ...AGING_BUCKETS.map(([key]) => dollars(r[key])),
    dollars(r.balance_cents)
  ])
];

export const MONTHLY_VALUES: Readonly<Record<string, (r: MonthlyRow) => SortValue>> = {
  month: (r) => r.month,
  claims: (r) => r.claims,
  charges: (r) => r.charges_cents,
  paid: (r) => r.paid_cents,
  adjusted: (r) => r.adjusted_cents,
  open: (r) => r.open_balance_cents,
  unrecovered: (r) => r.unrecovered_cents
};

export const MonthlyTable = ({ rows, all, sorting }: ResultTableProps<MonthlyRow>) => (
  <Table
    label="Charges and collections by month of service"
    {...sortingOf(sorting)}
    head={[
      { label: 'Month of service', sort: 'month' },
      numeric('Claims', 'claims'),
      numeric('Charges', 'charges'),
      numeric('Paid', 'paid'),
      numeric('Adjusted', 'adjusted'),
      { label: 'Collected', isNumeric: true, isSecondary: true },
      numeric('Open balance', 'open'),
      {
        label: 'Written Off / Collections',
        isNumeric: true,
        isSecondary: true,
        sort: 'unrecovered'
      }
    ]}
  >
    {rows.map((r) => (
      <TableRow key={r.month}>
        <TableCell>
          <span className="font-medium">{formatMonth(r.month)}</span>
        </TableCell>
        <TableCell kind="numeric">{r.claims}</TableCell>
        {money(r.charges_cents)}
        {money(r.paid_cents)}
        {money(r.adjusted_cents)}
        <TableCell kind="numeric" isMuted isSecondary>
          {percentOf(r.paid_cents, r.charges_cents)}
        </TableCell>
        {money(r.open_balance_cents)}
        <TableCell kind="numeric" isSecondary>
          {formatCents(r.unrecovered_cents)}
        </TableCell>
      </TableRow>
    ))}
    <TableTotalRow>
      <TableCell>Total</TableCell>
      <TableCell kind="numeric">{sum(all, (r) => r.claims)}</TableCell>
      {money(sum(all, (r) => r.charges_cents))}
      {money(sum(all, (r) => r.paid_cents))}
      {money(sum(all, (r) => r.adjusted_cents))}
      <TableCell kind="numeric" isSecondary>
        {percentOf(
          sum(all, (r) => r.paid_cents),
          sum(all, (r) => r.charges_cents)
        )}
      </TableCell>
      {money(sum(all, (r) => r.open_balance_cents))}
      <TableCell kind="numeric" isSecondary>
        {formatCents(sum(all, (r) => r.unrecovered_cents))}
      </TableCell>
    </TableTotalRow>
  </Table>
);

export const monthlyCsv = (rows: readonly MonthlyRow[]): CsvCell[][] => [
  ['Month', 'Claims', 'Charges', 'Paid', 'Adjusted', 'Open balance', 'Unrecovered'],
  ...rows.map((r) => [
    r.month,
    r.claims,
    dollars(r.charges_cents),
    dollars(r.paid_cents),
    dollars(r.adjusted_cents),
    dollars(r.open_balance_cents),
    dollars(r.unrecovered_cents)
  ])
];

const days = (value: number | null) => (value === null ? emptyValue : `${value} days`);

export const PAYER_VALUES: Readonly<Record<string, (r: PayerRow) => SortValue>> = {
  payer: (r) => r.payer,
  claims: (r) => r.claims,
  submitted: (r) => r.submitted,
  answered: (r) => r.answered,
  paid: (r) => r.paid_cents,
  adjusted: (r) => r.adjusted_cents,
  days: (r) => r.average_days_to_response
};

export const PayerTable = ({
  rows,
  sorting,
  patient
}: ResultTableProps<PayerRow> & { patient: PatientPayments }) => (
  <Table
    label="Payer performance"
    {...sortingOf(sorting)}
    head={[
      { label: 'Payer', sort: 'payer' },
      numeric('Claims', 'claims'),
      { label: 'Submitted', isNumeric: true, isSecondary: true, sort: 'submitted' },
      numeric('Answered', 'answered'),
      numeric('Paid', 'paid'),
      numeric('Adjusted', 'adjusted'),
      { label: 'Days to respond', isNumeric: true, isSecondary: true, sort: 'days' }
    ]}
  >
    {rows.map((r) => (
      <TableRow key={r.payer}>
        <TableCell>
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{r.payer}</span>
            {r.in_directory ? null : <Badge intent="warning">Not in payer directory</Badge>}
          </span>
        </TableCell>
        <TableCell kind="numeric">{r.claims}</TableCell>
        <TableCell kind="numeric" isSecondary>
          {r.submitted}
        </TableCell>
        <TableCell kind="numeric">{r.answered}</TableCell>
        {money(r.paid_cents)}
        {money(r.adjusted_cents)}
        <TableCell kind="numeric" isMuted isSecondary>
          {days(r.average_days_to_response)}
        </TableCell>
      </TableRow>
    ))}
    <TableRow>
      <TableCell>
        <span className="font-medium">{PATIENT}</span>
      </TableCell>
      <TableCell kind="numeric" isMuted>
        {emptyValue}
      </TableCell>
      <TableCell kind="numeric" isMuted isSecondary>
        {emptyValue}
      </TableCell>
      <TableCell kind="numeric" isMuted>
        {emptyValue}
      </TableCell>
      {money(patient.paid_cents)}
      {money(patient.adjusted_cents)}
      <TableCell kind="numeric" isMuted isSecondary>
        {emptyValue}
      </TableCell>
    </TableRow>
  </Table>
);

export const payerCsv = (rows: readonly PayerRow[], patient: PatientPayments): CsvCell[][] => [
  [
    'Payer',
    'In directory',
    'Claims',
    'Submitted',
    'Answered',
    'Paid',
    'Adjusted',
    'Days to respond'
  ],
  ...rows.map((r) => [
    r.payer,
    r.in_directory ? 'yes' : 'no',
    r.claims,
    r.submitted,
    r.answered,
    dollars(r.paid_cents),
    dollars(r.adjusted_cents),
    r.average_days_to_response
  ]),
  [
    PATIENT,
    null,
    null,
    null,
    null,
    dollars(patient.paid_cents),
    dollars(patient.adjusted_cents),
    null
  ]
];

export const HCPCS_VALUES: Readonly<Record<string, (r: HcpcsRow) => SortValue>> = {
  code: (r) => r.code,
  claims: (r) => r.claims,
  units: (r) => Number(r.units),
  price: (r) => r.average_unit_cents,
  charges: (r) => r.charges_cents
};

export const HcpcsTable = ({ rows, all, sorting }: ResultTableProps<HcpcsRow>) => (
  <Table
    label="Charges by HCPCS code"
    {...sortingOf(sorting)}
    head={[
      { label: 'HCPCS', sort: 'code' },
      { label: 'Service', isSecondary: true },
      numeric('Claims', 'claims'),
      numeric('Units', 'units'),
      { label: 'Average price', isNumeric: true, isSecondary: true, sort: 'price' },
      numeric('Charges', 'charges')
    ]}
  >
    {rows.map((r) => (
      <TableRow key={r.code}>
        <TableCell>
          <span className="font-mono font-semibold">{r.code}</span>
        </TableCell>
        <TableCell isMuted isSecondary>
          {HCPCS_LABELS[r.code] ?? emptyValue}
        </TableCell>
        <TableCell kind="numeric">{r.claims}</TableCell>
        <TableCell kind="numeric">{Number(r.units)}</TableCell>
        <TableCell kind="numeric" isMuted isSecondary>
          {formatCents(r.average_unit_cents)}
        </TableCell>
        {money(r.charges_cents)}
      </TableRow>
    ))}
    <TableTotalRow>
      <TableCell>Total</TableCell>
      <TableCell isSecondary />
      <TableCell />
      <TableCell />
      <TableCell isSecondary />
      {money(sum(all, (r) => r.charges_cents))}
    </TableTotalRow>
  </Table>
);

export const hcpcsCsv = (rows: readonly HcpcsRow[]): CsvCell[][] => [
  ['HCPCS', 'Service', 'Claims', 'Units', 'Average price', 'Charges'],
  ...rows.map((r) => [
    r.code,
    HCPCS_LABELS[r.code] ?? null,
    r.claims,
    Number(r.units),
    dollars(r.average_unit_cents),
    dollars(r.charges_cents)
  ])
];
