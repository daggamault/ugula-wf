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

type CodeSystem = 'icd10' | 'rxnorm' | 'snomed' | 'gnis' | 'state';

const CODE_SYSTEMS: Readonly<Record<string, CodeSystem>> = {
  'eHistory.08': 'icd10',
  'eInjury.01': 'icd10',
  'eScene.09': 'icd10',
  'eSituation.09': 'icd10',
  'eSituation.10': 'icd10',
  'eSituation.11': 'icd10',
  'eSituation.12': 'icd10',
  'eHistory.12': 'rxnorm',
  'eMedications.03': 'rxnorm',
  'eProcedures.03': 'snomed',
  'ePatient.06': 'gnis',
  'eScene.17': 'gnis',
  'eDisposition.04': 'gnis',
  'ePatient.08': 'state',
  'eScene.18': 'state',
  'eDisposition.05': 'state'
};

export const codeSystemOf = (list: string) =>
  Object.hasOwn(CODE_SYSTEMS, list) ? (CODE_SYSTEMS[list] ?? null) : null;

export const describeCode = (dictionary: ReportDictionary, list: string, code: string) =>
  dictionary.codes[list]?.[code] ?? null;
