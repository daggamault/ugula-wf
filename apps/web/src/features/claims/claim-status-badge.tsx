import { CLAIM_STATUSES } from '@ugula/billing';
import { Badge, type StatusBadgeStyle } from '../../shared/ui/badge.tsx';
import type { ClaimStatus } from './client.ts';

const STATUS: Record<ClaimStatus, StatusBadgeStyle> = {
  draft: { label: 'Draft' },
  needs_review: { intent: 'warning', label: 'Needs Review' },
  ready: { intent: 'primary', label: 'Ready to Submit' },
  submitted: { intent: 'info', label: 'Submitted' },
  follow_up: { intent: 'warning', label: 'Needs Follow-Up' },
  reconcile: { intent: 'warning', label: 'Reconcile Payment' },
  patient_balance: { intent: 'info', label: 'Patient Balance' },
  balance_review: { intent: 'warning', label: 'Balance Review' },
  paid: { intent: 'success', label: 'Paid' },
  written_off: { label: 'Written Off' },
  collections: { intent: 'danger', label: 'Sent to Collections' },
  void: { label: 'Void' }
};

export const CLAIM_FILTERS = [
  { value: 'open', label: 'Open (Not Closed)' },
  ...CLAIM_STATUSES.map((s) => ({ value: s, label: STATUS[s].label })),
  { value: 'all', label: 'All' }
] as const satisfies readonly { value: string; label: string }[];

export const ClaimStatusBadge = ({ status }: { status: ClaimStatus }) => (
  <Badge intent={STATUS[status].intent}>{STATUS[status].label}</Badge>
);
