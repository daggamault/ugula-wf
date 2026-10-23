export const SERVICE_LEVELS = ['BLS', 'ALS1', 'ALS2', 'SCT'] as const;

export type ServiceLevel = (typeof SERVICE_LEVELS)[number];

export const isServiceLevel = (x: unknown): x is ServiceLevel =>
  SERVICE_LEVELS.includes(x as ServiceLevel);

export const HCPCS_PATTERN = '^[A-Z][0-9]{4}$';

export type ClaimLine = { code: string; units: number };

export type PricedLine = ClaimLine & { unitCents: number; totalCents: number };

export type PricedClaim = { lines: PricedLine[]; totalCents: number };

const HCPCS = new RegExp(HCPCS_PATTERN);

export const readLines = (x: unknown): ClaimLine[] => {
  if (!Array.isArray(x) || !x.length) throw new Error('A claim needs at least one line');
  return x.map((line, i) => {
    const r = line !== null && typeof line === 'object' ? (line as Record<string, unknown>) : {};
    const { code, units } = r;
    if (typeof code !== 'string' || !HCPCS.test(code)) {
      throw new Error(`Line ${i + 1} has no valid HCPCS code`);
    }
    if (typeof units !== 'number' || !Number.isFinite(units) || units <= 0) {
      throw new Error(`Line ${i + 1} (${code}) needs a positive number of units`);
    }
    return { code, units };
  });
};

export const priceLines = (lines: ClaimLine[], fees: Record<string, number>): PricedClaim => {
  const missing = [...new Set(lines.map((l) => l.code))].filter((c) => !Object.hasOwn(fees, c));
  if (missing.length) throw new Error(`No fee scheduled for ${missing.join(', ')}`);
  const priced = lines.map((l) => {
    const unitCents = fees[l.code] ?? 0;
    return { ...l, unitCents, totalCents: Math.round(unitCents * l.units) };
  });
  return { lines: priced, totalCents: priced.reduce((sum, l) => sum + l.totalCents, 0) };
};

const isCents = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0;

export const readPricedLines = (x: unknown): PricedLine[] =>
  readLines(x).map((line, i) => {
    const r = (x as Record<string, unknown>[])[i] ?? {};
    if (!isCents(r.unitCents) || !isCents(r.totalCents)) {
      throw new Error(`Line ${i + 1} (${line.code}) has not been priced`);
    }
    return { ...line, unitCents: r.unitCents, totalCents: r.totalCents };
  });
