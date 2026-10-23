import { HCPCS_LABELS } from '@ugula/billing';
import { formatCents } from '../../shared/format.ts';
import { Badge } from '../../shared/ui/badge.tsx';
import { emptyValue } from '../../shared/ui/empty-state.tsx';
import {
  Table,
  TableCell,
  type TableColumn,
  TableRow,
  TableTotalRow
} from '../../shared/ui/table.tsx';
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

const numeric = (label: string): TableColumn => ({ label, isNumeric: true });

export const AgingTable = ({ rows }: { rows: readonly AgingRow[] }) => (
  <Table
    label="Accounts receivable aging"
    head={[
      'Owed by',
      numeric('Claims'),
      ...AGING_BUCKETS.map(([, label]) => numeric(label)),
      numeric('Balance')
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
      <TableCell kind="numeric">{sum(rows, (r) => r.claims)}</TableCell>
      {AGING_BUCKETS.map(([key]) => (
        <TableCell key={key} kind="numeric">
          {formatCents(sum(rows, (r) => r[key]))}
        </TableCell>
      ))}
      {money(sum(rows, (r) => r.balance_cents))}
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

export const MonthlyTable = ({ rows }: { rows: readonly MonthlyRow[] }) => (
  <Table
    label="Charges and collections by month of service"
    head={[
      'Month of service',
      numeric('Claims'),
      numeric('Charges'),
      numeric('Paid'),
      numeric('Adjusted'),
      { label: 'Collected', isNumeric: true, isSecondary: true },
      numeric('Open balance'),
      { label: 'Written off or sent to collections', isNumeric: true, isSecondary: true }
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
      <TableCell kind="numeric">{sum(rows, (r) => r.claims)}</TableCell>
      {money(sum(rows, (r) => r.charges_cents))}
      {money(sum(rows, (r) => r.paid_cents))}
      {money(sum(rows, (r) => r.adjusted_cents))}
      <TableCell kind="numeric" isSecondary>
        {percentOf(
          sum(rows, (r) => r.paid_cents),
          sum(rows, (r) => r.charges_cents)
        )}
      </TableCell>
      {money(sum(rows, (r) => r.open_balance_cents))}
      <TableCell kind="numeric" isSecondary>
        {formatCents(sum(rows, (r) => r.unrecovered_cents))}
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

export const PayerTable = ({
  rows,
  patient
}: {
  rows: readonly PayerRow[];
  patient: PatientPayments;
}) => (
  <Table
    label="Payer performance"
    head={[
      'Payer',
      numeric('Claims'),
      { label: 'Submitted', isNumeric: true, isSecondary: true },
      numeric('Answered'),
      numeric('Paid'),
      numeric('Adjusted'),
      { label: 'Days to respond', isNumeric: true, isSecondary: true }
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

export const HcpcsTable = ({ rows }: { rows: readonly HcpcsRow[] }) => (
  <Table
    label="Charges by HCPCS code"
    head={[
      'HCPCS',
      { label: 'Service', isSecondary: true },
      numeric('Claims'),
      numeric('Units'),
      { label: 'Average price', isNumeric: true, isSecondary: true },
      numeric('Charges')
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
      {money(sum(rows, (r) => r.charges_cents))}
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
