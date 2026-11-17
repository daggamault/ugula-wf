import { type Adjustment, type LineAdjudication, mergedAdjustments } from './adjudications.ts';
import { HCPCS_PATTERN } from './charges.ts';
import type { RemittanceService } from './x835.ts';

const HCPCS = new RegExp(HCPCS_PATTERN);

export type BilledLine = { position: number; code: string; chargeCents: number };

const byLineNumber = (s: RemittanceService, open: readonly BilledLine[]) => {
  const n = Number(s.lineNumber);
  return s.lineNumber && Number.isInteger(n) ? open.find((l) => l.position === n) : undefined;
};

const byCode = (s: RemittanceService, open: readonly BilledLine[]) => {
  const code = (s.originalCode ?? s.code).toUpperCase();
  const same = open.filter((l) => l.code.toUpperCase() === code);
  return same.find((l) => l.chargeCents === Math.abs(s.chargeCents)) ?? same[0];
};

export const matchServiceLines = (
  services: readonly RemittanceService[],
  lines: readonly BilledLine[]
): LineAdjudication[] => {
  const open = [...lines];
  return services.flatMap((s) => {
    const line = byLineNumber(s, open) ?? byCode(s, open);
    if (!line || !HCPCS.test(s.code)) return [];
    open.splice(open.indexOf(line), 1);
    return [
      {
        line: line.position,
        code: s.code,
        modifiers: s.modifiers,
        paidCents: s.paidCents,
        units: s.units,
        adjustments: s.adjustments.filter((a) => a.cents !== 0)
      }
    ];
  });
};

export const claimLevelAdjustments = (
  adjustments: readonly Adjustment[],
  lines: readonly LineAdjudication[]
) =>
  mergedAdjustments([
    ...adjustments,
    ...lines.flatMap((l) => l.adjustments.map((a) => ({ ...a, cents: -a.cents })))
  ]);
