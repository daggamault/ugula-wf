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

export const isClaimFilingCode = (x: unknown): x is ClaimFilingCode =>
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
