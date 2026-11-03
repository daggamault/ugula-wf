import { isRecord } from '@ugula/graph';
import { isCents } from './values.ts';

export const SERVICE_LEVELS = ['BLS', 'ALS1', 'ALS2', 'SCT'] as const;

export type ServiceLevel = (typeof SERVICE_LEVELS)[number];

export const isServiceLevel = (x: unknown): x is ServiceLevel =>
  SERVICE_LEVELS.includes(x as ServiceLevel);

export const TRIP_TYPES = [
  'emergency',
  'scheduled',
  'treatNoTransport',
  'refusal',
  'noClaim'
] as const;

export type TripType = (typeof TRIP_TYPES)[number];

export const isTripType = (x: unknown): x is TripType => TRIP_TYPES.includes(x as TripType);

export const TRIP_TYPE_LABELS: Record<TripType, string> = {
  emergency: 'Emergency transport',
  scheduled: 'Scheduled or interfacility transport',
  treatNoTransport: 'Treated, not transported',
  refusal: 'Refused care or transport',
  noClaim: 'No claim (cancelled or no patient contact)'
};

export const NO_TRANSPORT_TRIPS: readonly TripType[] = ['treatNoTransport', 'refusal'];

export const MAX_LOADED_MILES = 500;

export const LIKELY_LOADED_MILES = 100;

export const HCPCS_PATTERN = '^[A-Z][0-9]{4}$';

export const NO_TRANSPORT_CODE = 'A0998';

export const UNIT_SCALE = 1;

export type ClaimLine = { code: string; units: number };

export type PricedLine = ClaimLine & { unitCents: number; totalCents: number };

type PricedClaim = { lines: PricedLine[]; totalCents: number; missing: string[] };

const HCPCS = new RegExp(HCPCS_PATTERN);

const STEP = 10 ** UNIT_SCALE;

export const roundUnits = (units: number) => Math.ceil(units * STEP - 1e-9) / STEP;

export const isTransport = (lines: readonly ClaimLine[]) =>
  lines.some((l) => l.code !== NO_TRANSPORT_CODE);

export const readLines = (x: unknown): ClaimLine[] => {
  if (!Array.isArray(x) || !x.length) throw new Error('A claim needs at least one line');
  return x.map((line, i) => {
    const { code, units } = isRecord(line) ? line : {};
    if (typeof code !== 'string' || !HCPCS.test(code)) {
      throw new Error(`Line ${i + 1} has no valid HCPCS code`);
    }
    if (typeof units !== 'number' || !Number.isFinite(units) || units <= 0) {
      throw new Error(`Line ${i + 1} (${code}) needs a positive number of units`);
    }
    return { code, units: roundUnits(units) };
  });
};

export const priceLines = (lines: ClaimLine[], fees: Record<string, number>): PricedClaim => {
  const prices = new Map(Object.entries(fees));
  const priced = lines.flatMap((l) => {
    const unitCents = prices.get(l.code);
    return unitCents === undefined
      ? []
      : [{ ...l, unitCents, totalCents: Math.round(unitCents * l.units) }];
  });
  return {
    lines: priced,
    totalCents: priced.reduce((sum, l) => sum + l.totalCents, 0),
    missing: [...new Set(lines.map((l) => l.code))].filter((c) => !prices.has(c))
  };
};

export const readPricedLines = (x: unknown): PricedLine[] =>
  readLines(x).map((line, i) => {
    const r = Array.isArray(x) && isRecord(x[i]) ? x[i] : {};
    if (!isCents(r.unitCents) || !isCents(r.totalCents)) {
      throw new Error(`Line ${i + 1} (${line.code}) has not been priced`);
    }
    return { ...line, unitCents: r.unitCents, totalCents: r.totalCents };
  });
