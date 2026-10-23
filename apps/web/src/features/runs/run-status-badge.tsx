import { Badge, type StatusBadgeStyle } from '../../shared/ui/badge.tsx';
import type { RunStatus } from './client.ts';

const styles: Record<RunStatus, StatusBadgeStyle> = {
  running: { intent: 'info', label: 'Running' },
  suspended: { intent: 'warning', label: 'Waiting' },
  completed: { intent: 'success', label: 'Completed' },
  faulted: { intent: 'danger', label: 'Stuck' },
  failed: { intent: 'danger', label: 'Failed' },
  cancelled: { label: 'Cancelled' }
};

export const RunStatusBadge = ({ status }: { status: RunStatus }) => (
  <Badge intent={styles[status].intent}>{styles[status].label}</Badge>
);
