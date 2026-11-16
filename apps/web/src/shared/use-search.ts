import { useEffect, useState } from 'react';
import { useResource } from './use-resource.ts';

const SEARCH_DELAY_MS = 250;

const NONE: readonly never[] = [];

export const searchStatus = (
  q: string,
  loading: boolean,
  failure: Error | undefined,
  prompt: string
) => failure?.message ?? (loading ? 'Searching…' : q ? 'No matches' : prompt);

export const useSearch = <T>(
  key: string,
  load: (q: string, signal: AbortSignal) => Promise<readonly T[]>,
  prompt: string
) => {
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const next = text.trim();
    if (!next) {
      setQ('');
      return;
    }
    const timer = setTimeout(() => setQ(next), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text]);
  const found = useResource(`${key}?${q}`, (signal) => load(q, signal));
  return {
    q,
    results: found.data ?? NONE,
    onSearch: setText,
    emptyText: searchStatus(q, found.loading, found.error, prompt)
  };
};
