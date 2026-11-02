import type { DateRange, ReportsClient } from './client.ts';
import {
  AGING_COLUMNS,
  HCPCS_COLUMNS,
  MONTHLY_COLUMNS,
  PAYER_COLUMNS,
  payerLines,
  type ReportColumn
} from './report-columns.ts';

export type ReportId = 'aging' | 'monthly' | 'payers' | 'hcpcs';

export type Report<T, R> = {
  id: ReportId;
  title: string;
  description: string;
  usesPeriod: boolean;
  load: (client: ReportsClient, range: DateRange) => Promise<T>;
  rowsOf: (data: T) => readonly R[];
  columns: readonly ReportColumn<R>[];
  fileName: (data: T, range: DateRange) => string;
};

export type AnyReport = Report<unknown, unknown>;

const report = <T, R>(r: Report<T, R>) => r as unknown as AnyReport;

const suffix = (range: DateRange) => `${range.from}-to-${range.to}.csv`;

export const REPORTS: readonly AnyReport[] = [
  report({
    id: 'aging',
    title: 'Accounts Receivable Aging',
    description:
      'Open balances as of today, by who owes them now: the next payer due to answer, or the patient once every payer has. Ages count from the date of service.',
    usesPeriod: false,
    load: (client) => client.aging(),
    rowsOf: (d) => d.rows,
    columns: AGING_COLUMNS,
    fileName: (d) => `ar-aging-${d.asOf}.csv`
  }),
  report({
    id: 'monthly',
    title: 'Charges and Collections by Month',
    description: 'What was billed for each month of service, and what has come back since.',
    usesPeriod: true,
    load: (client, range) => client.monthly(range),
    rowsOf: (d) => d.rows,
    columns: MONTHLY_COLUMNS,
    fileName: (_, range) => `monthly-${suffix(range)}`
  }),
  report({
    id: 'payers',
    title: 'Payer Performance',
    description:
      'How each payer handled the claims billed to it: how many were answered, what they paid, and how long they took.',
    usesPeriod: true,
    load: (client, range) => client.payers(range),
    rowsOf: (d) =>
      d.rows.length || d.patient.paid_cents || d.patient.adjusted_cents
        ? payerLines(d.rows, d.patient)
        : [],
    columns: PAYER_COLUMNS,
    fileName: (_, range) => `payers-${suffix(range)}`
  }),
  report({
    id: 'hcpcs',
    title: 'Charges by HCPCS Code',
    description: 'Billed services and mileage, by procedure code.',
    usesPeriod: true,
    load: (client, range) => client.hcpcs(range),
    rowsOf: (d) => d.rows,
    columns: HCPCS_COLUMNS,
    fileName: (_, range) => `hcpcs-${suffix(range)}`
  })
];

export const findReport = (id: string) => REPORTS.find((r) => r.id === id);
