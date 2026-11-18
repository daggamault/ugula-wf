import { type Adjustment, type LineAdjudication, mergedAdjustments } from './adjudications.ts';

export const claimLevelAdjustments = (
  adjustments: readonly Adjustment[],
  lines: readonly LineAdjudication[]
) =>
  mergedAdjustments([
    ...adjustments,
    ...lines.flatMap((l) => l.adjustments.map((a) => ({ ...a, cents: -a.cents })))
  ]);
