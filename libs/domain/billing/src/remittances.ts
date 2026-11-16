import { type Adjustment, DENIAL_ROUTES, mergedAdjustments } from './claims.ts';
import type { RemittanceClaim } from './x835.ts';

const REMITTANCE_ROUTES = [
  'reconcile',
  ...DENIAL_ROUTES,
  'reversal',
  'review',
  'unmatched'
] as const;

export type RemittanceRoute = (typeof REMITTANCE_ROUTES)[number];

const isRemittanceRoute = (x: unknown): x is RemittanceRoute =>
  REMITTANCE_ROUTES.includes(x as RemittanceRoute);

export type RemittanceLine = {
  position: number;
  reference: string;
  claimId: string | null;
  coverageId: string | null;
  payerName: string | null;
  status: string;
  remarks: string[];
  crossoverPayer: string | null;
  denied: boolean;
  reversal: boolean;
  reversesPosted: boolean;
  takeback: boolean;
  paidCents: number;
  adjustments: Adjustment[];
};

export type RemittancePosting = {
  position: number;
  route: RemittanceRoute;
  message: string;
  adjustedCents: number;
  crossover: boolean;
};

const POSITIONS: Readonly<Record<string, number>> = {
  '1': 0,
  '19': 0,
  '2': 1,
  '20': 1,
  '3': 2,
  '21': 2
};

export const remittanceLine = (
  position: number,
  c: RemittanceClaim,
  matched: {
    claimId: string | null;
    coverageId: string | null;
    payerName: string | null;
    reversesPosted: boolean;
  }
): RemittanceLine => {
  const adjustments = mergedAdjustments(c.adjustments);
  return {
    position,
    reference: c.claimNumber,
    ...matched,
    status: c.status,
    remarks: c.remarks,
    crossoverPayer: c.crossoverPayer,
    denied: c.denied,
    reversal: c.reversal,
    takeback: c.paidCents < 0 || adjustments.some((a) => a.cents < 0),
    paidCents: c.paidCents,
    adjustments
  };
};

type PostingCoverage = { id: string; payerId: string | null };

export const remittanceCoverage = (
  coverages: readonly PostingCoverage[],
  payerId: string | null,
  status: string
) => {
  const position = POSITIONS[status];
  const inOrder = position === undefined ? null : (coverages[position] ?? null);
  if (!payerId) return inOrder;
  const byPayer = coverages.filter((c) => c.payerId?.toUpperCase() === payerId.toUpperCase());
  if (byPayer.length === 1) return byPayer[0] ?? null;
  if (byPayer.length > 1) return inOrder && byPayer.includes(inOrder) ? inOrder : null;
  return inOrder?.payerId === null ? inOrder : null;
};

export const readPostings = (x: unknown): RemittancePosting[] =>
  (Array.isArray(x) ? x : []).flatMap((p) => {
    if (typeof p !== 'object' || p === null) return [];
    const { position, route, message, adjustedCents, crossover } = p as Record<string, unknown>;
    if (typeof position !== 'number' || !isRemittanceRoute(route)) return [];
    const text = typeof message === 'string' ? message : '';
    const crossed = crossover === true;
    if (adjustedCents == null) {
      return [{ position, route, message: text, adjustedCents: 0, crossover: crossed }];
    }
    return typeof adjustedCents === 'number' &&
      Number.isInteger(adjustedCents) &&
      (route === 'reversal' ? adjustedCents <= 0 : adjustedCents >= 0)
      ? [{ position, route, message: text, adjustedCents, crossover: crossed }]
      : [
          {
            position,
            route: 'review' as const,
            message: `The adjustment of ${String(adjustedCents)} cents is not a whole amount of the right sign; post it by hand`,
            adjustedCents: 0,
            crossover: false
          }
        ];
  });
