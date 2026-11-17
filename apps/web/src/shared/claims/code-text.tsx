import { type CodeDescriptions, type CodeSet, describeCode, formatIcd10 } from '@ugula/billing';
import { classNamesOf } from '../class-names.ts';

export type Coded = { text: string; code: string | null };

export const coded = (description: string | null, code: string): Coded =>
  description ? { text: description, code } : { text: code, code: null };

export const codedText = ({ text, code }: Coded) => (code ? `${text} (${code})` : text);

export const shownCode = (set: CodeSet, code: string) =>
  set === 'icd10cm' ? formatIcd10(code) : code;

export const codeOf = (codes: CodeDescriptions, set: CodeSet, code: string) =>
  coded(describeCode(codes, set, code), shownCode(set, code));

export const CodeLabel = ({
  value: { text, code },
  isInline = false
}: {
  value: Coded;
  isInline?: boolean | undefined;
}) =>
  code === null ? (
    <span>{text}</span>
  ) : (
    <span className={isInline ? undefined : 'flex flex-col gap-0.5'}>
      <span>{text}</span>{' '}
      <span
        className={classNamesOf(
          'text-surface-fg-muted text-xs font-normal tabular-nums',
          isInline && 'ml-1'
        )}
      >
        {code}
      </span>
    </span>
  );

export const CodeText = ({
  codes,
  set,
  code,
  isInline
}: {
  codes: CodeDescriptions;
  set: CodeSet;
  code: string;
  isInline?: boolean | undefined;
}) => <CodeLabel value={codeOf(codes, set, code)} isInline={isInline} />;
