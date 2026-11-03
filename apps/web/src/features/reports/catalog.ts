import type { SelectOption } from '../../shared/ui/select.tsx';
import {
  ACTIVITY_COLUMNS,
  agingColumns,
  denialColumns,
  HCPCS_COLUMNS,
  IMPORT_COLUMNS,
  LEVEL_COLUMNS,
  MONTHLY_COLUMNS,
  PAYMENT_COLUMNS,
  PRODUCTIVITY_COLUMNS,
  payerColumns,
  type ReportColumn,
  UNBILLED_COLUMNS,
  WRITE_OFF_COLUMNS,
  workQueueColumns
} from './report-columns.ts';

export type DateKind = 'service' | 'posted' | 'closed' | 'completed' | 'received';

export type Report<R> = {
  id: string;
  title: string;
  description: string;
  dates: DateKind | null;
  groups: readonly SelectOption[] | null;
  columns: (group: string | null) => readonly ReportColumn<R>[];
};

export type AnyReport = Report<unknown>;

const report = <R>(r: Report<R>) => r as unknown as AnyReport;

const fixed =
  <R>(columns: readonly ReportColumn<R>[]) =>
  () =>
    columns;

const PAYER_GROUPS = [
  { value: 'payer', label: 'Payer' },
  { value: 'class', label: 'Financial Class' }
] as const;

export const REPORTS: readonly AnyReport[] = [
  report({
    id: 'aging',
    title: 'Accounts Receivable Aging',
    description:
      'Open balances as of today by who owes them now: the next payer due to answer, or the patient once every payer has. Ages count from the date of service.',
    dates: null,
    groups: PAYER_GROUPS,
    columns: agingColumns
  }),
  report({
    id: 'unbilled',
    title: 'Unbilled Claims',
    description:
      'Claims not yet submitted to a payer, oldest first, with the task each one is waiting on.',
    dates: null,
    groups: null,
    columns: fixed(UNBILLED_COLUMNS)
  }),
  report({
    id: 'monthly',
    title: 'Collections by Month of Service',
    description:
      'What was charged for each month of service, what has been collected, adjusted or written off since, and how long claims took to bill.',
    dates: 'service',
    groups: null,
    columns: fixed(MONTHLY_COLUMNS)
  }),
  report({
    id: 'activity',
    title: 'Monthly Activity',
    description:
      'Claims billed, payments, adjustments, write-offs and collections booked in each month, for closing the month.',
    dates: 'posted',
    groups: null,
    columns: fixed(ACTIVITY_COLUMNS)
  }),
  report({
    id: 'payments',
    title: 'Payments Posted',
    description:
      'Every payer and patient payment and refund posted, with check or EFT numbers for matching deposits.',
    dates: 'posted',
    groups: null,
    columns: fixed(PAYMENT_COLUMNS)
  }),
  report({
    id: 'denials',
    title: 'Denials and Adjustments',
    description:
      'Adjustment reason codes from payer responses, with how many came on responses that paid nothing.',
    dates: 'posted',
    groups: [
      { value: 'payer', label: 'Payer' },
      { value: 'reason', label: 'Reason Code' }
    ],
    columns: denialColumns
  }),
  report({
    id: 'write-offs',
    title: 'Write-Offs and Collections',
    description: 'Claims closed with a balance left, either written off or sent to collections.',
    dates: 'closed',
    groups: null,
    columns: fixed(WRITE_OFF_COLUMNS)
  }),
  report({
    id: 'payers',
    title: 'Payer Performance',
    description:
      'How each payer handled the claims billed to it: what it paid, how often it denied them, and how long it took to pay.',
    dates: 'service',
    groups: PAYER_GROUPS,
    columns: payerColumns
  }),
  report({
    id: 'hcpcs',
    title: 'Charges by HCPCS Code',
    description: 'Billed services and mileage, by procedure code.',
    dates: 'service',
    groups: null,
    columns: fixed(HCPCS_COLUMNS)
  }),
  report({
    id: 'levels',
    title: 'Trips by Level of Service',
    description: 'Trips, loaded miles and charges by level of service.',
    dates: 'service',
    groups: null,
    columns: fixed(LEVEL_COLUMNS)
  }),
  report({
    id: 'work-queue',
    title: 'Work Queue',
    description: 'Open tasks and stuck runs right now, by how long they have waited.',
    dates: null,
    groups: [
      { value: 'queue', label: 'Task Type' },
      { value: 'assignee', label: 'Assignee' }
    ],
    columns: workQueueColumns
  }),
  report({
    id: 'productivity',
    title: 'Biller Productivity',
    description: 'Tasks completed, claims submitted and payments posted by each biller.',
    dates: 'completed',
    groups: null,
    columns: fixed(PRODUCTIVITY_COLUMNS)
  }),
  report({
    id: 'imports',
    title: 'Import Reconciliation',
    description:
      'Each PCR file received and what its reports became: billed, still in draft, voided, revisions or without a claim.',
    dates: 'received',
    groups: null,
    columns: fixed(IMPORT_COLUMNS)
  })
];

export const findReport = (id: string) => REPORTS.find((r) => r.id === id);

export const groupOf = (r: Pick<AnyReport, 'groups'>, value: string | null) =>
  r.groups?.find((g) => g.value === value) ?? r.groups?.[0] ?? null;
