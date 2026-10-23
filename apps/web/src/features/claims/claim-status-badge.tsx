import { Badge, type StatusBadgeStyle } from '../../shared/ui/badge.tsx';
import type { ClaimStatus } from './client.ts';

const STATUS: Record<ClaimStatus, StatusBadgeStyle> = {
  open: { intent: 'info', label: 'Open' },
  paid: { intent: 'success', label: 'Paid' },
  written_off: { label: 'Written off' },
  collections: { intent: 'danger', label: 'Collections' }
};

export const claimStatusLabel = (status: ClaimStatus) => STATUS[status].label;

export const ClaimStatusBadge = ({ status }: { status: ClaimStatus }) => (
  <Badge intent={STATUS[status].intent}>{STATUS[status].label}</Badge>
);
