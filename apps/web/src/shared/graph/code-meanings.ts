import { createContext, useContext, useEffect, useState } from 'react';

export type Meaning = { code: string; description: string };

type Describe = (kind: string, codes: readonly string[]) => Promise<Meaning[]>;

export type CodeMeanings = (
  kind: string,
  codes: readonly string[]
) => Promise<ReadonlyMap<string, string>>;

export const MEANINGS_LIMIT = 50;

export const createCodeMeanings = (describe: Describe): CodeMeanings => {
  const cache = new Map<string, Promise<ReadonlyMap<string, string>>>();
  return (kind, codes) => {
    const asked = [...new Set(codes)].slice(0, MEANINGS_LIMIT);
    const key = `${kind}\t${asked.join(',')}`;
    const cached = cache.get(key);
    if (cached) return cached;
    const found = describe(kind, asked)
      .then((ms): ReadonlyMap<string, string> => new Map(ms.map((m) => [m.code, m.description])))
      .catch((): ReadonlyMap<string, string> => {
        cache.delete(key);
        return new Map();
      });
    cache.set(key, found);
    return found;
  };
};

export const CodeMeaningsContext = createContext<CodeMeanings | null>(null);

const NONE: ReadonlyMap<string, string> = new Map();

export const useCodeMeanings = (kind: string, codes: readonly string[]) => {
  const meanings = useContext(CodeMeaningsContext);
  const [found, setFound] = useState(NONE);
  const key = codes.join(',');
  useEffect(() => {
    if (!meanings || !key) return;
    let current = true;
    void meanings(kind, key.split(',')).then((m) => {
      if (current) setFound(m);
    });
    return () => {
      current = false;
    };
  }, [meanings, kind, key]);
  return found;
};
