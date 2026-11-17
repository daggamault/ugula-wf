export const ADJUSTMENT_GROUPS = {
  CO: 'Contractual obligation',
  PR: 'Patient responsibility',
  OA: 'Other adjustment',
  PI: 'Payer initiated reduction',
  CR: 'Correction or reversal'
} as const;

export type AdjustmentGroup = keyof typeof ADJUSTMENT_GROUPS;

export const isAdjustmentGroup = (x: unknown): x is AdjustmentGroup =>
  typeof x === 'string' && Object.hasOwn(ADJUSTMENT_GROUPS, x);

export type Adjustment = { group: AdjustmentGroup; reason: string; cents: number };

export const MAX_LINE_MODIFIERS = 4;

export const MODIFIER_PATTERN = '^[A-Z0-9]{2}$';

export type LineAdjudication = {
  line: number;
  code: string;
  modifiers: string[];
  paidCents: number;
  units: number;
  adjustments: Adjustment[];
};

export type Adjudication = {
  paidCents: number;
  adjustedCents: number;
  paidOn: string;
  adjustments: Adjustment[];
  lines: LineAdjudication[];
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
