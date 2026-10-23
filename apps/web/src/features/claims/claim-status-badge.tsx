import { Badge, type StatusBadgeStyle } from '../../shared/ui/badge.tsx';
import type { ClaimStatus } from './client.ts';

const STATUS: Record<ClaimStatus, StatusBadgeStyle> = {
  open: { tone: 'info', label: 'Open' },
  paid: { tone: 'success', label: 'Paid' },
  written_off: { tone: 'neutral', label: 'Written off' },
  collections: { tone: 'danger', label: 'Collections' }
};

export const claimStatusLabel = (status: ClaimStatus) => STATUS[status].label;

export const ClaimStatusBadge = ({ status }: { status: ClaimStatus }) => (
  <Badge tone={STATUS[status].tone}>{STATUS[status].label}</Badge>
);
