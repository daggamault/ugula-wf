export const CLAIM_FILING_CODES = {
  MA: 'Medicare Part A',
  MB: 'Medicare Part B',
  MC: 'Medicaid',
  CI: 'Commercial insurance',
  BL: 'Blue Cross/Blue Shield',
  HM: 'HMO',
  WC: "Workers' compensation",
  CH: 'TRICARE (CHAMPUS)',
  VA: 'Veterans Affairs',
  OF: 'Other federal program'
} as const;

export type ClaimFilingCode = keyof typeof CLAIM_FILING_CODES;

export const MAX_FILING_LIMIT_DAYS = 3650;

export const CORRECTION_METHODS = {
  replacement: 'Replacement claim (frequency 7 or 8)',
  reopening: 'Reopening request (Medicare)'
} as const;

export type CorrectionMethod = keyof typeof CORRECTION_METHODS;

export const PLAN_TYPES = {
  fully_insured: 'Fully insured',
  self_funded: 'Self-funded (ERISA)',
  government: 'Government'
} as const;

export type PlanType = keyof typeof PLAN_TYPES;

export const MAX_APPEAL_DAYS = 730;

const isClaimFilingCode = (x: unknown): x is ClaimFilingCode =>
  typeof x === 'string' && Object.hasOwn(CLAIM_FILING_CODES, x);

export const isValidNpi = (npi: string) => {
  if (!/^\d{10}$/.test(npi)) return false;
  const digits = `80840${npi}`.split('').map(Number);
  const sum = digits.reduceRight((total, d, i) => {
    const doubled = (digits.length - 1 - i) % 2 === 1 ? d * 2 : d;
    return total + (doubled > 9 ? doubled - 9 : doubled);
  }, 0);
  return sum % 10 === 0;
};

export const payerKey = (name: string) =>
  name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

export type DirectoryPayer = { id: string; name: string; claimFiling: string };

export type Payer = DirectoryPayer & {
  payerCode: string;
  filingLimitDays: number | null;
  correctionMethod: CorrectionMethod | null;
  appealDays: number | null;
  planType: PlanType | null;
};

export type PayerCandidate = DirectoryPayer & { similarity: number };

export const payerDocument = ({ name, claimFiling }: Omit<DirectoryPayer, 'id'>) =>
  isClaimFilingCode(claimFiling) ? `${name} (${CLAIM_FILING_CODES[claimFiling]})` : name;
