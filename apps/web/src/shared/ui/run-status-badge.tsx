import { Badge, type StatusBadgeStyle } from './badge.tsx';

export type RunStatus = 'running' | 'suspended' | 'completed' | 'faulted' | 'failed' | 'cancelled';

export const RUN_STATUSES: readonly RunStatus[] = [
  'running',
  'suspended',
  'faulted',
  'completed',
  'failed',
  'cancelled'
];

export const runStatusStyles: Readonly<Record<RunStatus, StatusBadgeStyle>> = {
  running: { intent: 'info', label: 'Running' },
  suspended: { intent: 'warning', label: 'Waiting' },
  completed: { intent: 'success', label: 'Completed' },
  faulted: { intent: 'danger', label: 'Stuck' },
  failed: { intent: 'danger', label: 'Failed' },
  cancelled: { label: 'Cancelled' }
};

export const RunStatusBadge = ({ status }: { status: RunStatus }) => (
  <Badge intent={runStatusStyles[status].intent}>{runStatusStyles[status].label}</Badge>
);
