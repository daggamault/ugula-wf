import type { InboundKind } from './x12.ts';

export const PAYER_FILE_KINDS = [
  '835',
  '999',
  '277',
  '271',
  'TA1',
  '277S'
] as const satisfies InboundKind[];

export const PAYER_FILE_LABELS: Record<InboundKind, string> = {
  '835': 'Remittance (835)',
  '999': 'Acknowledgment (999)',
  '277': 'Claim acknowledgment (277CA)',
  '271': 'Eligibility response (271)',
  TA1: 'Interchange acknowledgment (TA1)',
  '277S': 'Claim status (277)'
};

export const PAYER_FILE_OUTCOMES = [
  'posted',
  'accepted',
  'rejected',
  'eligible',
  'ineligible',
  'unmatched',
  'review',
  'duplicate',
  'status'
] as const;

export type PayerFileOutcome = (typeof PAYER_FILE_OUTCOMES)[number];

export const PROBLEM_OUTCOMES: readonly PayerFileOutcome[] = [
  'rejected',
  'ineligible',
  'unmatched',
  'review'
];

export const REVIEW_OUTCOMES: readonly PayerFileOutcome[] = ['unmatched', 'review'];

export const ELIGIBILITY_STATUSES = ['active', 'inactive'] as const;

export type EligibilityStatus = (typeof ELIGIBILITY_STATUSES)[number];
