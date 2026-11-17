import { CLAIM_STATUS_LABELS } from '@ugula/billing';
import { Badge } from '../../shared/ui/badge.tsx';
import type { Intent } from '../../shared/ui/intent.ts';
import type { ClaimStatus } from './client.ts';

const INTENTS: Partial<Record<ClaimStatus, Intent>> = {
  needs_review: 'warning',
  ready: 'primary',
  submitted: 'info',
  follow_up: 'warning',
  reconcile: 'warning',
  denied: 'danger',
  facility_billing: 'info',
  patient_balance: 'info',
  balance_review: 'warning',
  paid: 'success',
  collections: 'danger'
};

export const ClaimStatusBadge = ({ status }: { status: ClaimStatus }) => (
  <Badge intent={INTENTS[status]}>{CLAIM_STATUS_LABELS[status]}</Badge>
);
