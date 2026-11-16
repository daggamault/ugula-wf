import { type CodeSet, formatIcd10 } from '@ugula/billing';
import type { Json } from '@ugula/graph';
import { ArrowDownIcon, ArrowUpIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { described } from './claims/code-text.tsx';
import type { Code, CodesClient } from './codes.ts';
import { IconButton } from './ui/icon-button.tsx';
import { Select, type SelectOption } from './ui/select.tsx';
import { useResource } from './use-resource.ts';

const SEARCH_DELAY_MS = 250;

export const shownCode = (set: CodeSet, code: string) =>
  set === 'icd10cm' ? formatIcd10(code) : code;

export const chosenCodes = (value: Json): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string')
    : typeof value === 'string' && value
      ? [value]
      : [];

export const codeOptions = (
  set: CodeSet,
  chosen: readonly string[],
  known: readonly Code[],
  found: readonly Code[]
): SelectOption[] => {
  const descriptions = new Map([...known, ...found].map((c) => [c.code, c.description]));
  const codes = [...new Set([...chosen, ...found.map((c) => c.code)])];
  return codes.map((code) => ({
    value: code,
    label: described(descriptions.get(code) ?? null, shownCode(set, code))
  }));
};

export const moveCode = (codes: readonly string[], index: number, by: -1 | 1) => {
  const to = index + by;
  const moved = codes[index];
  const other = codes[to];
  if (moved === undefined || other === undefined) return [...codes];
  return codes.map((c, i) => (i === index ? other : i === to ? moved : c));
};

export const searchStatus = (q: string, loading: boolean, failure: Error | undefined) =>
  failure?.message ??
  (loading ? 'Searching…' : q ? 'No matching codes' : 'Type a code or words from its description');

type CodeFieldProps = {
  id: string;
  label: string;
  codeSet: CodeSet;
  codeList: string | null;
  codes: CodesClient;
  isMultiple: boolean;
  value: Json;
  onChange: (value: Json) => void;
  error?: string | undefined;
  isRequired?: boolean | undefined;
};

export const CodeField = ({
  id,
  label,
  codeSet,
  codeList,
  codes,
  isMultiple,
  value,
  onChange,
  error,
  isRequired
}: CodeFieldProps) => {
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQ(text.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text]);
  const chosen = chosenCodes(value);
  const known = useResource(`codes:${codeSet}:${chosen.join(',')}`, (signal) =>
    codes.describe(codeSet, chosen, signal)
  );
  const found = useResource(`codes:${codeSet}:${codeList ?? ''}?${q}`, (signal) =>
    q || codeList ? codes.search(codeSet, q, q ? null : codeList, signal) : Promise.resolve([])
  );
  const options = codeOptions(codeSet, chosen, known.data ?? [], found.data ?? []);
  const search = {
    onSearch: setText,
    emptyText: searchStatus(q, found.loading, found.error)
  };
  if (!isMultiple) {
    return (
      <Select
        {...search}
        id={id}
        label={label}
        error={error}
        required={isRequired}
        options={[{ value: '', label: 'Choose…' }, ...options]}
        value={chosen[0] ?? ''}
        onChange={(v) => onChange(v || null)}
      />
    );
  }
  const labelOf = (code: string) =>
    options.find((o) => o.value === code)?.label ?? shownCode(codeSet, code);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Select
        {...search}
        isMultiple
        id={id}
        label={label}
        error={error}
        required={isRequired}
        options={options}
        value={chosen}
        onChange={(v) => onChange(v)}
      />
      {chosen.length > 1 ? (
        <ol aria-label={`${label} in order`} className="flex flex-col gap-1">
          {chosen.map((code, i) => (
            <li key={code} className="flex items-center gap-2 text-sm">
              <span className="text-surface-fg-muted w-5 shrink-0 tabular-nums">{i + 1}.</span>
              <span className="min-w-0 flex-1 truncate">{labelOf(code)}</span>
              <IconButton
                label={`Move ${shownCode(codeSet, code)} up`}
                tooltip="Move Up"
                icon={ArrowUpIcon}
                disabledReason={i === 0 ? 'Already first.' : undefined}
                onClick={() => onChange(moveCode(chosen, i, -1))}
              />
              <IconButton
                label={`Move ${shownCode(codeSet, code)} down`}
                tooltip="Move Down"
                icon={ArrowDownIcon}
                disabledReason={i === chosen.length - 1 ? 'Already last.' : undefined}
                onClick={() => onChange(moveCode(chosen, i, 1))}
              />
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
};
