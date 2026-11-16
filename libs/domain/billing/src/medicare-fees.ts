import type { ClaimLine } from './charges.ts';

export const RURALITIES = ['urban', 'rural', 'superRural'] as const;

export type Rurality = (typeof RURALITIES)[number];

export const isRurality = (x: unknown): x is Rurality => RURALITIES.includes(x as Rurality);

export const CARRIER_PATTERN = '^[0-9]{5}$';

export const LOCALITY_PATTERN = '^[0-9]{2}$';

const RURAL_SHORT_TRIP_MILES = 17;

export type MedicareLocality = {
  carrier: string;
  locality: string;
  rurality: Rurality;
  plusFourNeeded: boolean;
};

export type MedicareFee = {
  code: string;
  urbanCents: number;
  ruralCents: number;
  superRuralCents: number | null;
  ruralShortTripCents: number | null;
};

type AllowedLine = ClaimLine & { allowedCents: number };

type AllowedClaim = { lines: AllowedLine[]; totalCents: number; missing: string[] };

const allowedCentsOf = (fee: MedicareFee, units: number, rurality: Rurality) => {
  if (rurality === 'urban') return Math.round(fee.urbanCents * units);
  const rate = rurality === 'superRural' ? (fee.superRuralCents ?? fee.ruralCents) : fee.ruralCents;
  const short = fee.ruralShortTripCents === null ? 0 : Math.min(units, RURAL_SHORT_TRIP_MILES);
  return Math.round(short * (fee.ruralShortTripCents ?? 0) + (units - short) * rate);
};

export const medicareAllowed = (
  lines: readonly ClaimLine[],
  fees: readonly MedicareFee[],
  rurality: Rurality
): AllowedClaim => {
  const byCode = new Map(fees.map((f) => [f.code, f]));
  const allowed = lines.flatMap((l) => {
    const fee = byCode.get(l.code);
    return fee ? [{ ...l, allowedCents: allowedCentsOf(fee, l.units, rurality) }] : [];
  });
  return {
    lines: allowed,
    totalCents: allowed.reduce((sum, l) => sum + l.allowedCents, 0),
    missing: [...new Set(lines.filter((l) => !byCode.has(l.code)).map((l) => l.code))]
  };
};
