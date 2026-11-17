export const CLAIM_STATUSES = ['needs_review'] as const;

export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const CLAIM_STATUS_LABELS: Record<ClaimStatus, string> = {
  needs_review: 'Needs Review'
};
