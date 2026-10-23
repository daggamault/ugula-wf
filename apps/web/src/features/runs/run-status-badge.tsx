import { Badge, type StatusBadgeStyle } from '../../shared/ui/badge.tsx';
import type { RunStatus } from './client.ts';

const styles: Record<RunStatus, StatusBadgeStyle> = {
  running: { tone: 'info', label: 'Running' },
  suspended: { tone: 'warning', label: 'Waiting' },
  completed: { tone: 'success', label: 'Completed' },
  faulted: { tone: 'danger', label: 'Stuck' },
  failed: { tone: 'danger', label: 'Failed' },
  cancelled: { tone: 'neutral', label: 'Cancelled' }
};

export const runStatusLabel = (status: RunStatus) => styles[status].label;

export const RunStatusBadge = ({ status }: { status: RunStatus }) => (
  <Badge tone={styles[status].tone}>{styles[status].label}</Badge>
);
