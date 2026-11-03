import { isRecord, type Json } from '@ugula/graph';

type CodeRef = { list: string; code: string };

export type ReportTerms = { elements: string[]; codes: CodeRef[] };

export type ReportDictionary = {
  elements: Record<string, string>;
  codes: Record<string, Record<string, string>>;
};

const TEXT = '#text';

const isCode = (value: string) => /^[\w.-]{1,20}$/.test(value);

const attributeList = (name: string) => `@${name}`;

export const reportTerms = (report: Json): ReportTerms => {
  const elements = new Set<string>();
  const codes = new Map<string, CodeRef>();
  const code = (list: string, value: Json | undefined) => {
    if (typeof value === 'string' && isCode(value))
      codes.set(`${list}\t${value}`, { list, code: value });
  };
  const visit = (name: string, value: Json) => {
    if (Array.isArray(value)) {
      for (const v of value) visit(name, v);
      return;
    }
    elements.add(name);
    if (!isRecord(value)) {
      code(name, value);
      return;
    }
    code(name, value[TEXT]);
    for (const [key, child] of Object.entries(value)) {
      if (key === TEXT) continue;
      if (key.startsWith('@')) code(attributeList(key.slice(1)), child);
      else visit(key, child);
    }
  };
  if (isRecord(report)) for (const [key, value] of Object.entries(report)) visit(key, value);
  return { elements: [...elements].sort(), codes: [...codes.values()] };
};

export const describeCode = (dictionary: ReportDictionary, list: string, code: string) =>
  dictionary.codes[list]?.[code] ?? null;
