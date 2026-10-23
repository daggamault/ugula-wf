import type { ReactNode } from 'react';
import type { DateRange, ReportsClient } from './client.ts';
import type { CsvCell } from './csv.ts';
import {
  AgingTable,
  agingCsv,
  HcpcsTable,
  hcpcsCsv,
  MonthlyTable,
  monthlyCsv,
  PayerTable,
  payerCsv
} from './report-tables.tsx';

export type ReportId = 'aging' | 'monthly' | 'payers' | 'hcpcs';

export type Report<T> = {
  id: ReportId;
  title: string;
  description: string;
  usesPeriod: boolean;
  load: (client: ReportsClient, range: DateRange) => Promise<T>;
  isEmpty: (data: T) => boolean;
  table: (data: T) => ReactNode;
  csv: (data: T, range: DateRange) => { name: string; rows: CsvCell[][] };
};

const report = <T,>(r: Report<T>) => r as unknown as Report<unknown>;

const suffix = (range: DateRange) => `${range.from}-to-${range.to}.csv`;

export const REPORTS: readonly Report<unknown>[] = [
  report({
    id: 'aging',
    title: 'Accounts Receivable Aging',
    description:
      'Open balances as of today, by who owes them now: the next payer due to answer, or the patient once every payer has. Ages count from the date of service.',
    usesPeriod: false,
    load: (client) => client.aging(),
    isEmpty: (d) => !d.rows.length,
    table: (d) => <AgingTable rows={d.rows} />,
    csv: (d) => ({ name: `ar-aging-${d.asOf}.csv`, rows: agingCsv(d.rows) })
  }),
  report({
    id: 'monthly',
    title: 'Charges and Collections by Month',
    description: 'What was billed for each month of service, and what has come back since.',
    usesPeriod: true,
    load: (client, range) => client.monthly(range),
    isEmpty: (d) => !d.rows.length,
    table: (d) => <MonthlyTable rows={d.rows} />,
    csv: (d, range) => ({ name: `monthly-${suffix(range)}`, rows: monthlyCsv(d.rows) })
  }),
  report({
    id: 'payers',
    title: 'Payer Performance',
    description:
      'How each payer handled the claims billed to it: how many were answered, what they paid, and how long they took.',
    usesPeriod: true,
    load: (client, range) => client.payers(range),
    isEmpty: (d) => !d.rows.length && !d.patient.paid_cents && !d.patient.adjusted_cents,
    table: (d) => <PayerTable rows={d.rows} patient={d.patient} />,
    csv: (d, range) => ({ name: `payers-${suffix(range)}`, rows: payerCsv(d.rows, d.patient) })
  }),
  report({
    id: 'hcpcs',
    title: 'Charges by HCPCS Code',
    description: 'Billed services and mileage, by procedure code.',
    usesPeriod: true,
    load: (client, range) => client.hcpcs(range),
    isEmpty: (d) => !d.rows.length,
    table: (d) => <HcpcsTable rows={d.rows} />,
    csv: (d, range) => ({ name: `hcpcs-${suffix(range)}`, rows: hcpcsCsv(d.rows) })
  })
];

export const findReport = (id: string) => REPORTS.find((r) => r.id === id);
