import type { CodeSet } from '@ugula/billing';
import type { Json } from '@ugula/graph';
import { useEffect, useState } from 'react';
import type { Code, CodesClient } from '../codes.ts';
import { MoveButtons, RemoveButton } from '../ui/icon-button.tsx';
import { Select, type SelectOption } from '../ui/select.tsx';
import { useResource } from '../use-resource.ts';
import { useSearch } from '../use-search.ts';
import { CodeLabel, coded, shownCode } from './code-text.tsx';

type Labels = Readonly<Record<string, string>>;

const SEARCH_PROMPT = 'Type a code or words from its description';

export const chosenCodes = (value: Json): string[] =>
  Array.isArray(value)
    ? [...new Set(value.filter((v): v is string => typeof v === 'string' && v !== ''))]
    : typeof value === 'string' && value
      ? [value]
      : [];

export const labelsOf = (codes: readonly Code[]): Labels =>
  Object.fromEntries(codes.map((c) => [c.code, c.description]));

export const codeLabel = (set: CodeSet, labels: Labels, code: string) =>
  coded(labels[code] ?? null, shownCode(set, code));

export const codeOptions = (set: CodeSet, codes: readonly string[], labels: Labels) =>
  [...new Set(codes)].map((code): SelectOption => {
    const { text, code: shown } = codeLabel(set, labels, code);
    return { value: code, label: text, code: shown };
  });

export const moveCode = (codes: readonly string[], index: number, by: -1 | 1) => {
  const to = index + by;
  const moved = codes[index];
  const other = codes[to];
  if (moved === undefined || other === undefined) return [...codes];
  return codes.map((c, i) => (i === index ? other : i === to ? moved : c));
};

const useLabels = (
  set: CodeSet,
  codes: CodesClient,
  chosen: readonly string[],
  seen: readonly Code[]
) => {
  const [labels, setLabels] = useState<Labels>({});
  const missing = chosen.filter((c) => !Object.hasOwn(labels, c)).sort();
  const fetched = useResource(`code-labels:${set}:${missing.join(',')}`, (signal) =>
    codes.describe(set, missing, signal)
  );
  useEffect(() => {
    if (seen.length) setLabels((known) => ({ ...known, ...labelsOf(seen) }));
  }, [seen]);
  useEffect(() => {
    if (fetched.data?.length) setLabels((known) => ({ ...known, ...labelsOf(fetched.data ?? []) }));
  }, [fetched.data]);
  return labels;
};

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
  const search = useSearch<Code>(
    `codes:${codeSet}:${codeList ?? ''}`,
    (q, signal) =>
      q || codeList ? codes.search(codeSet, q, q ? null : codeList, signal) : Promise.resolve([]),
    SEARCH_PROMPT
  );
  const chosen = chosenCodes(value);
  const labels = useLabels(codeSet, codes, chosen, search.results);
  const [announced, setAnnounced] = useState('');
  const [focusId, setFocusId] = useState<string | null>(null);
  useEffect(() => {
    if (focusId) document.getElementById(focusId)?.focus();
  }, [focusId]);
  const found = search.results.map((c) => c.code);
  const common = {
    id,
    label,
    error,
    required: isRequired,
    onSearch: search.onSearch,
    emptyText: search.emptyText
  };
  if (!isMultiple) {
    const [code] = chosen;
    return (
      <Select
        {...common}
        placeholder="Choose…"
        summary={code ? <CodeLabel value={codeLabel(codeSet, labels, code)} isInline /> : ''}
        options={codeOptions(codeSet, search.q ? found : [...chosen, ...found], labels)}
        value={code ?? ''}
        onChange={(v) => onChange(v || null)}
      />
    );
  }
  const reorder = (next: string[], message: string, focus: string) => {
    onChange(next);
    setAnnounced(message);
    setFocusId(focus);
  };
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Select
        {...common}
        isMultiple
        placeholder="Add a code"
        summary=""
        options={codeOptions(codeSet, found, labels)}
        value={chosen}
        onChange={(v) => onChange(v)}
      />
      {chosen.length ? (
        <ol aria-label={`${label} in order`} className="flex flex-col gap-1">
          {chosen.map((code, i) => {
            const shown = shownCode(codeSet, code);
            return (
              <li key={code} className="flex items-center gap-2 text-sm">
                <span className="text-surface-fg-muted w-5 shrink-0 tabular-nums">{i + 1}.</span>
                <span className="min-w-0 flex-1 truncate">
                  <CodeLabel value={codeLabel(codeSet, labels, code)} isInline />
                </span>
                <MoveButtons
                  name={shown}
                  index={i}
                  count={chosen.length}
                  idPrefix={`${id}-${code}`}
                  onMove={(by) =>
                    reorder(
                      moveCode(chosen, i, by),
                      `${shown} moved to ${i + 1 + by}`,
                      `${id}-${code}-${by < 0 ? 'up' : 'down'}`
                    )
                  }
                />
                <RemoveButton
                  label={`Remove ${shown}`}
                  onClick={() =>
                    reorder(
                      chosen.filter((c) => c !== code),
                      `${shown} removed`,
                      id
                    )
                  }
                />
              </li>
            );
          })}
        </ol>
      ) : null}
      <span role="status" className="sr-only">
        {announced}
      </span>
    </div>
  );
};
