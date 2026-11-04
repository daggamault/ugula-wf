import type { Adjustment } from './claims.ts';
import type { RemittanceClaim } from './x835.ts';

type RemittancePosting =
  | {
      post: true;
      paidCents: number;
      adjustedCents: number;
      adjustments: Adjustment[];
      payerClaimNumber: string | null;
    }
  | { post: false; reason: string };

const PATIENT_RESPONSIBILITY = 'PR';

const ADJUSTMENT_LIMIT = 99;

const POSITIONS: Readonly<Record<string, number>> = {
  '1': 0,
  '19': 0,
  '2': 1,
  '20': 1,
  '3': 2,
  '21': 2
};

const merged = (adjustments: readonly Adjustment[]) => {
  const byCode = new Map<string, Adjustment>();
  for (const a of adjustments) {
    const key = `${a.group}:${a.reason}`;
    const seen = byCode.get(key);
    byCode.set(key, seen ? { ...seen, cents: seen.cents + a.cents } : { ...a });
  }
  return [...byCode.values()].filter((a) => a.cents !== 0);
};

export const remittancePosting = (c: RemittanceClaim): RemittancePosting => {
  if (c.reversal) {
    return {
      post: false,
      reason: 'The payer reversed an earlier payment on this claim; post the takeback by hand'
    };
  }
  const adjustments = merged(c.adjustments);
  if (c.paidCents < 0 || adjustments.some((a) => a.cents < 0)) {
    return {
      post: false,
      reason: 'The remittance takes money back on this claim; post the correction by hand'
    };
  }
  if (adjustments.length > ADJUSTMENT_LIMIT) {
    return { post: false, reason: 'The remittance has more reason codes than a payment can hold' };
  }
  return {
    post: true,
    paidCents: c.paidCents,
    adjustedCents: c.denied
      ? 0
      : adjustments
          .filter((a) => a.group !== PATIENT_RESPONSIBILITY)
          .reduce((sum, a) => sum + a.cents, 0),
    adjustments,
    payerClaimNumber: c.payerClaimNumber
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
