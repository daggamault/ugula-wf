import { type CodeDescriptions, type CodeSet, describeCode, formatIcd10 } from '@ugula/billing';

export const described = (description: string | null, code: string) =>
  description ? `${description} (${code})` : code;

export const codeText = (codes: CodeDescriptions, set: CodeSet, code: string) =>
  described(describeCode(codes, set, code), set === 'icd10cm' ? formatIcd10(code) : code);

export const CodeText = ({
  codes,
  set,
  code
}: {
  codes: CodeDescriptions;
  set: CodeSet;
  code: string;
}) => <span>{codeText(codes, set, code)}</span>;
