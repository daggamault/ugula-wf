import { type Adjustment, DENIAL_ROUTES } from './claims.ts';
import type { RemittanceClaim } from './x835.ts';

export const REMITTANCE_ROUTES = ['reconcile', ...DENIAL_ROUTES, 'review', 'unmatched'] as const;

export type RemittanceRoute = (typeof REMITTANCE_ROUTES)[number];

export const isRemittanceRoute = (x: unknown): x is RemittanceRoute =>
  REMITTANCE_ROUTES.includes(x as RemittanceRoute);

export type RemittanceLine = {
  position: number;
  reference: string;
  claimId: string | null;
  coverageId: string | null;
  payerName: string | null;
  denied: boolean;
  reversal: boolean;
  takeback: boolean;
  paidCents: number;
  adjustments: Adjustment[];
};

export type RemittancePosting = {
  position: number;
  route: RemittanceRoute;
  message: string;
  adjustedCents: number;
};

const POSITIONS: Readonly<Record<string, number>> = {
  '1': 0,
  '19': 0,
  '2': 1,
  '20': 1,
  '3': 2,
  '21': 2
};

export const mergedAdjustments = (adjustments: readonly Adjustment[]) => {
  const byCode = new Map<string, Adjustment>();
  for (const a of adjustments) {
    const key = `${a.group}:${a.reason}`;
    const seen = byCode.get(key);
    byCode.set(key, seen ? { ...seen, cents: seen.cents + a.cents } : { ...a });
  }
  return [...byCode.values()].filter((a) => a.cents !== 0);
};

export const remittanceLine = (
  position: number,
  c: RemittanceClaim,
  matched: { claimId: string | null; coverageId: string | null; payerName: string | null }
): RemittanceLine => {
  const adjustments = mergedAdjustments(c.adjustments);
  return {
    position,
    reference: c.claimNumber,
    ...matched,
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
  const byPayer = payerId
    ? coverages.filter((c) => c.payerId?.toUpperCase() === payerId.toUpperCase())
    : [];
  if (byPayer.length === 1) return byPayer[0] ?? null;
  const position = POSITIONS[status];
  return position === undefined ? null : (coverages[position] ?? null);
};

export const readPostings = (x: unknown): RemittancePosting[] =>
  (Array.isArray(x) ? x : []).flatMap((p) => {
    if (typeof p !== 'object' || p === null) return [];
    const { position, route, message, adjustedCents } = p as Record<string, unknown>;
    return typeof position === 'number' && isRemittanceRoute(route)
      ? [
          {
            position,
            route,
            message: typeof message === 'string' ? message : '',
            adjustedCents:
              typeof adjustedCents === 'number' && Number.isInteger(adjustedCents)
                ? adjustedCents
                : 0
          }
        ]
      : [];
  });
