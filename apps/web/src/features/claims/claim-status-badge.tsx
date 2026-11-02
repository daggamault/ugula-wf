import { CLAIM_STATUSES } from '@ugula/billing';
import { Badge, type StatusBadgeStyle } from '../../shared/ui/badge.tsx';
import type { ClaimStatus } from './client.ts';

const STATUS: Record<ClaimStatus, StatusBadgeStyle> = {
  draft: { label: 'Draft' },
  needs_review: { intent: 'warning', label: 'Needs review' },
  ready: { intent: 'primary', label: 'Ready to submit' },
  submitted: { intent: 'info', label: 'Submitted' },
  follow_up: { intent: 'warning', label: 'Needs follow-up' },
  reconcile: { intent: 'warning', label: 'Reconcile payment' },
  patient_balance: { intent: 'info', label: 'Patient balance' },
  balance_review: { intent: 'warning', label: 'Balance review' },
  paid: { intent: 'success', label: 'Paid' },
  written_off: { label: 'Written off' },
  collections: { intent: 'danger', label: 'Sent to collections' },
  void: { label: 'Void' }
};

export const claimStatusLabel = (status: ClaimStatus) => STATUS[status].label;

export const CLAIM_FILTERS = [
  { value: 'open', label: 'Open (all not closed)' },
  ...CLAIM_STATUSES.map((s) => ({ value: s, label: STATUS[s].label })),
  { value: 'all', label: 'All' }
] as const satisfies readonly { value: string; label: string }[];

export const ClaimStatusBadge = ({ status }: { status: ClaimStatus }) => (
  <Badge intent={STATUS[status].intent}>{STATUS[status].label}</Badge>
);
