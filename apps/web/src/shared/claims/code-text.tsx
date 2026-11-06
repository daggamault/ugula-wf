import { type CodeDescriptions, type CodeSet, describeCode, formatIcd10 } from '@ugula/billing';

export const codeText = (codes: CodeDescriptions, set: CodeSet, code: string) => {
  const shown = set === 'icd10cm' ? formatIcd10(code) : code;
  const description = describeCode(codes, set, code);
  return description ? `${description} (${shown})` : shown;
};

export const CodeText = ({
  codes,
  set,
  code
}: {
  codes: CodeDescriptions;
  set: CodeSet;
  code: string;
}) => <span>{codeText(codes, set, code)}</span>;
