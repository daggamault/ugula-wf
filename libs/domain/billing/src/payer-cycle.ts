export const COVERAGE_STATUSES = [
  'pending',
  'sent',
  'accepted',
  'rejected',
  'forwarded',
  'paid',
  'denied',
  'skipped'
] as const;

export type CoverageStatus = (typeof COVERAGE_STATUSES)[number];

export const COVERAGE_STATUS_LABELS: Record<CoverageStatus, string> = {
  pending: 'Not Billed Yet',
  sent: 'Sent',
  accepted: 'Accepted',
  rejected: 'Rejected',
  forwarded: 'Forwarded',
  paid: 'Paid',
  denied: 'Denied',
  skipped: 'Skipped'
};

const FINISHED: readonly CoverageStatus[] = ['paid', 'denied', 'skipped'];

const ADJUDICATED: readonly CoverageStatus[] = ['paid', 'denied'];

const BILLABLE: readonly CoverageStatus[] = ['pending', 'rejected'];

const WAITING: readonly CoverageStatus[] = ['sent', 'accepted', 'forwarded'];

export const isAdjudicated = (s: CoverageStatus) => ADJUDICATED.includes(s);

export const isBillable = (s: CoverageStatus) => BILLABLE.includes(s);

export const isWaiting = (s: CoverageStatus) => WAITING.includes(s);

export const currentPayerIndex = (coverages: readonly { status: CoverageStatus }[]) =>
  coverages.findIndex((c) => !FINISHED.includes(c.status));
