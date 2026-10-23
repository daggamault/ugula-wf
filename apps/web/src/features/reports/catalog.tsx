import type { ReactNode } from 'react';
import type { TableSorting } from '../../shared/ui/table.tsx';
import type { SortDir, SortValue } from '../../shared/url-state.ts';
import type { DateRange, ReportsClient } from './client.ts';
import type { CsvCell } from './csv.ts';
import {
  AGING_VALUES,
  AgingTable,
  agingCsv,
  HCPCS_VALUES,
  HcpcsTable,
  hcpcsCsv,
  MONTHLY_VALUES,
  MonthlyTable,
  monthlyCsv,
  PAYER_VALUES,
  PayerTable,
  payerCsv
} from './report-tables.tsx';

export type ReportId = 'aging' | 'monthly' | 'payers' | 'hcpcs';

export type Report<T, R> = {
  id: ReportId;
  title: string;
  description: string;
  usesPeriod: boolean;
  sorts: Readonly<Record<string, SortDir>>;
  sort: string;
  values: Readonly<Record<string, (row: R) => SortValue>>;
  load: (client: ReportsClient, range: DateRange) => Promise<T>;
  rowsOf: (data: T) => readonly R[];
  isEmpty: (data: T) => boolean;
  table: (data: T, rows: readonly R[], sorting: TableSorting) => ReactNode;
  csv: (data: T, range: DateRange) => { name: string; rows: CsvCell[][] };
};

const report = <T, R>(r: Report<T, R>) => r as unknown as Report<unknown, unknown>;

const suffix = (range: DateRange) => `${range.from}-to-${range.to}.csv`;

const directions = <K extends string>(values: Readonly<Record<K, unknown>>, ascending: K[]) =>
  Object.fromEntries(
    Object.keys(values).map((k) => [k, ascending.includes(k as K) ? 'asc' : 'desc'])
  ) as Record<string, SortDir>;

export const REPORTS: readonly Report<unknown, unknown>[] = [
  report({
    id: 'aging',
    title: 'Accounts Receivable Aging',
    description:
      'Open balances as of today, by who owes them now: the next payer due to answer, or the patient once every payer has. Ages count from the date of service.',
    usesPeriod: false,
    sorts: directions(AGING_VALUES, ['owedBy']),
    sort: 'balance',
    values: AGING_VALUES,
    load: (client) => client.aging(),
    rowsOf: (d) => d.rows,
    isEmpty: (d) => !d.rows.length,
    table: (d, rows, sorting) => <AgingTable rows={rows} all={d.rows} sorting={sorting} />,
    csv: (d) => ({ name: `ar-aging-${d.asOf}.csv`, rows: agingCsv(d.rows) })
  }),
  report({
    id: 'monthly',
    title: 'Charges and Collections by Month',
    description: 'What was billed for each month of service, and what has come back since.',
    usesPeriod: true,
    sorts: directions(MONTHLY_VALUES, []),
    sort: 'month',
    values: MONTHLY_VALUES,
    load: (client, range) => client.monthly(range),
    rowsOf: (d) => d.rows,
    isEmpty: (d) => !d.rows.length,
    table: (d, rows, sorting) => <MonthlyTable rows={rows} all={d.rows} sorting={sorting} />,
    csv: (d, range) => ({ name: `monthly-${suffix(range)}`, rows: monthlyCsv(d.rows) })
  }),
  report({
    id: 'payers',
    title: 'Payer Performance',
    description:
      'How each payer handled the claims billed to it: how many were answered, what they paid, and how long they took.',
    usesPeriod: true,
    sorts: directions(PAYER_VALUES, ['payer', 'days']),
    sort: 'claims',
    values: PAYER_VALUES,
    load: (client, range) => client.payers(range),
    rowsOf: (d) => d.rows,
    isEmpty: (d) => !d.rows.length && !d.patient.paid_cents && !d.patient.adjusted_cents,
    table: (d, rows, sorting) => (
      <PayerTable rows={rows} all={d.rows} sorting={sorting} patient={d.patient} />
    ),
    csv: (d, range) => ({ name: `payers-${suffix(range)}`, rows: payerCsv(d.rows, d.patient) })
  }),
  report({
    id: 'hcpcs',
    title: 'Charges by HCPCS Code',
    description: 'Billed services and mileage, by procedure code.',
    usesPeriod: true,
    sorts: directions(HCPCS_VALUES, ['code']),
    sort: 'charges',
    values: HCPCS_VALUES,
    load: (client, range) => client.hcpcs(range),
    rowsOf: (d) => d.rows,
    isEmpty: (d) => !d.rows.length,
    table: (d, rows, sorting) => <HcpcsTable rows={rows} all={d.rows} sorting={sorting} />,
    csv: (d, range) => ({ name: `hcpcs-${suffix(range)}`, rows: hcpcsCsv(d.rows) })
  })
];

export const findReport = (id: string) => REPORTS.find((r) => r.id === id);
