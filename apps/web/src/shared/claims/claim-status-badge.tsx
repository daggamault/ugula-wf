import { CLAIM_STATUS_LABELS, type ClaimStatus } from '@ugula/billing';
import { Badge } from '../ui/badge.tsx';
import type { Intent } from '../ui/intent.ts';

const INTENTS: Record<ClaimStatus, Intent> = {
  needs_review: 'warning',
  approved: 'success',
  on_hold: 'danger'
};

export const ClaimStatusBadge = ({ status }: { status: ClaimStatus }) => (
  <Badge intent={INTENTS[status]}>{CLAIM_STATUS_LABELS[status]}</Badge>
);
