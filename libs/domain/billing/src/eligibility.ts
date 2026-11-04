import type { PayerFileOutcome } from './payer-files.ts';
import type { EligibilityResult } from './x271.ts';

const MEDICARE_FILINGS: readonly (string | null)[] = ['MA', 'MB'];

export const ADVANTAGE_NOTE = 'Bill the Medicare Advantage plan instead';

type EligibilityFinding = {
  active: boolean | null;
  outcome: Extract<PayerFileOutcome, 'eligible' | 'ineligible' | 'review'>;
  note: string;
};

export const eligibilityFinding = (
  r: EligibilityResult,
  claimFiling: string | null
): EligibilityFinding => {
  const note = [
    r.planName,
    r.coverageStart || r.coverageEnd
      ? `Covered ${r.coverageStart ?? '?'} to ${r.coverageEnd ?? 'now'}`
      : null,
    ...r.messages
  ]
    .filter(Boolean)
    .join('; ');
  if (r.active === null) {
    return { active: null, outcome: 'review', note: note || 'The payer did not say' };
  }
  if (r.advantagePlan && MEDICARE_FILINGS.includes(claimFiling)) {
    return {
      active: r.active,
      outcome: 'review',
      note: [`${ADVANTAGE_NOTE}: ${r.advantagePlan}`, note].filter(Boolean).join('; ')
    };
  }
  return { active: r.active, outcome: r.active ? 'eligible' : 'ineligible', note };
};
