import type { PayerFileOutcome } from '@ugula/billing';
import type { StatusBadgeStyle } from './ui/badge.tsx';

export const OUTCOME_STYLES: Readonly<Record<PayerFileOutcome, StatusBadgeStyle>> = {
  posted: { intent: 'success', label: 'Posted' },
  accepted: { intent: 'success', label: 'Accepted' },
  eligible: { intent: 'success', label: 'Eligible' },
  duplicate: { label: 'Already Posted' },
  rejected: { intent: 'danger', label: 'Rejected' },
  ineligible: { intent: 'danger', label: 'Not Eligible' },
  unmatched: { intent: 'warning', label: 'No Match' },
  review: { intent: 'warning', label: 'Needs Review' }
};
