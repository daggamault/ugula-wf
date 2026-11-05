import type { Completer, CompletionRequest } from './completions.ts';

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

const FEDERAL_FILING_LIMIT_DAYS: Partial<Record<ClaimFilingCode, number>> = {
  MA: 365,
  MB: 365,
  CH: 365
};

const MEDICARE_FILINGS: readonly (string | null)[] = ['MA', 'MB'];

export const isMedicareFiling = (claimFiling: string | null) =>
  MEDICARE_FILINGS.includes(claimFiling);

export const filingLimitOf = (claimFiling: string | null, days: number | null) =>
  days ??
  (isClaimFilingCode(claimFiling) ? (FEDERAL_FILING_LIMIT_DAYS[claimFiling] ?? null) : null);

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

export const payerQuery = (name: string) =>
  `Instruct: Given the name of a health insurance payer from an ambulance patient care report, retrieve the matching payer from the agency payer directory\nQuery: ${name}`;

export type DirectoryPayer = { id: string; name: string; claimFiling: string };

export type PayerCandidate = DirectoryPayer & { similarity: number };

export type PayerLookup = {
  name: string;
  known: DirectoryPayer | null;
  candidates: PayerCandidate[];
};

export const payerDocument = ({ name, claimFiling }: Omit<DirectoryPayer, 'id'>) =>
  isClaimFilingCode(claimFiling) ? `${name} (${CLAIM_FILING_CODES[claimFiling]})` : name;

const CHOICE_SYSTEM =
  'You match insurance payer names for ambulance billing. Given a payer name from a patient care report and a numbered list of payers from the agency directory (with their claim filing type), answer with the number of the directory payer that is the same insurer or program, or 0 when none clearly is. Abbreviations, states and plan or contractor names may differ. Self pay, unknown and unrelated insurers are 0.';

const payerChoiceRequest = (name: string, candidates: DirectoryPayer[]): CompletionRequest => ({
  system: CHOICE_SYSTEM,
  user: [
    `Report payer: ${name}`,
    'Directory:',
    ...candidates.map((c, i) => `${i + 1}. ${payerDocument(c)}`)
  ].join('\n'),
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['choice'],
    properties: { choice: { type: 'integer', minimum: 0, maximum: candidates.length } }
  },
  maxTokens: 20
});

export const SUGGEST_SIMILARITY = 0.8;

export const suggestPayer = async <T extends DirectoryPayer>(
  completer: Completer,
  name: string,
  candidates: T[],
  signal?: AbortSignal
): Promise<T | null> => {
  if (!candidates.length) return null;
  const answer = await completer.complete(payerChoiceRequest(name, candidates), signal);

  const choice =
    answer !== null && typeof answer === 'object' && 'choice' in answer ? answer.choice : 0;
  return Number.isInteger(choice) ? (candidates[(choice as number) - 1] ?? null) : null;
};
