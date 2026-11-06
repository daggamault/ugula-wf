import { ORIGIN_DESTINATION_CODES } from './claim-details.ts';

export const CODE_SETS = ['icd10cm', 'hcpcs', 'modifier', 'carc', 'rarc', 'pos'] as const;

export type CodeSet = (typeof CODE_SETS)[number];

export const isCodeSet = (x: unknown): x is CodeSet => CODE_SETS.includes(x as CodeSet);

export type CodeRef = { set: CodeSet; code: string };

export type CodeDescriptions = Partial<Record<CodeSet, Record<string, string>>>;

export const formatIcd10 = (code: string) =>
  code.length > 3 && !code.includes('.') ? `${code.slice(0, 3)}.${code.slice(3)}` : code;

const placeOf = (letter: string) =>
  Object.hasOwn(ORIGIN_DESTINATION_CODES, letter) ? ORIGIN_DESTINATION_CODES[letter] : null;

const originDestinationText = (code: string) => {
  const [from, to] = [...code].map(placeOf);
  return code.length === 2 && from && to ? `${from} to ${to.toLowerCase()}` : null;
};

export const describeCode = (descriptions: CodeDescriptions, set: CodeSet, code: string) =>
  descriptions[set]?.[code] ?? (set === 'modifier' ? originDestinationText(code) : null);

export const claimCodeRefs = (claim: {
  lines: readonly { code: string }[];
  diagnoses: readonly string[];
}): CodeRef[] => [
  ...claim.lines.map((l): CodeRef => ({ set: 'hcpcs', code: l.code })),
  ...claim.diagnoses.map((d): CodeRef => ({ set: 'icd10cm', code: d }))
];
