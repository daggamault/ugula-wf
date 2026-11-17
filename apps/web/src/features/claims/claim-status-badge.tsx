import { CLAIM_STATUS_LABELS } from '@ugula/billing';
import { Badge } from '../../shared/ui/badge.tsx';
import type { Intent } from '../../shared/ui/intent.ts';
import type { ClaimStatus } from './client.ts';

const INTENTS: Record<ClaimStatus, Intent> = {
  needs_review: 'warning'
};

export const ClaimStatusBadge = ({ status }: { status: ClaimStatus }) => (
  <Badge intent={INTENTS[status]}>{CLAIM_STATUS_LABELS[status]}</Badge>
);
