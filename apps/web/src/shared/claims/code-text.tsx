import { type CodeDescriptions, type CodeSet, describeCode, formatIcd10 } from '@ugula/billing';

export const CodeText = ({
  codes,
  set,
  code
}: {
  codes: CodeDescriptions;
  set: CodeSet;
  code: string;
}) => {
  const description = describeCode(codes, set, code);
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="font-mono font-semibold">
        {set === 'icd10cm' ? formatIcd10(code) : code}
      </span>
      {description ? <span className="text-surface-fg-muted text-xs">{description}</span> : null}
    </span>
  );
};
