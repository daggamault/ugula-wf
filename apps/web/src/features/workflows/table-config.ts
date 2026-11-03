import type { ConditionOp, Json, ValueType } from '@ugula/graph';

export type Column = { name: string; type: ValueType; label?: string };

type Condition = { op: ConditionOp; value?: Json };

export type Rule = { label: string; when: Record<string, Condition>; set: Record<string, Json> };

export type DecisionConfig = {
  inputs: Column[];
  outputs: Column[];
  rules: Rule[];
  otherwise: Record<string, Json>;
};

export type LookupConfig = {
  type: ValueType;
  rows: { key: string; value: Json }[];
  fallback: Json;
};

export const COLUMN_TYPES = [
  { value: 'string', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'integer', label: 'Whole Number' },
  { value: 'boolean', label: 'True or False' },
  { value: 'list', label: 'List of Text' }
] as const;

export const OPS: readonly { value: ConditionOp | ''; label: string }[] = [
  { value: '', label: 'Any Value' },
  { value: 'is', label: 'Is' },
  { value: 'isNot', label: 'Is Not' },
  { value: 'oneOf', label: 'Is One Of' },
  { value: 'notOneOf', label: 'Is Not One Of' },
  { value: 'startsWith', label: 'Starts With' },
  { value: 'gt', label: 'Greater Than' },
  { value: 'gte', label: 'At Least' },
  { value: 'lt', label: 'Less Than' },
  { value: 'lte', label: 'At Most' },
  { value: 'empty', label: 'Is Empty' },
  { value: 'present', label: 'Has a Value' }
];

const LIST_OPS: readonly ConditionOp[] = ['oneOf', 'notOneOf', 'startsWith'];

export const takesValue = (op: ConditionOp) => op !== 'empty' && op !== 'present';

export const takesList = (op: ConditionOp) => LIST_OPS.includes(op);

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

export const columnKind = (type: ValueType) =>
  typeof type === 'string' ? type : 'list' in type ? 'list' : 'string';

export const columnType = (kind: string): ValueType =>
  kind === 'list' ? { list: 'string' } : (kind as ValueType);

export const formatCell = (value: Json | undefined): string =>
  value === null || value === undefined
    ? ''
    : Array.isArray(value)
      ? value.map((x) => formatCell(x)).join(', ')
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value);

export const parseCell = (text: string, type: ValueType): Json => {
  const raw = text.trim();
  if (!raw) return null;
  switch (columnKind(type)) {
    case 'list':
      return raw
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
    case 'boolean':
      return raw === 'true' ? true : raw === 'false' ? false : null;
    case 'number':
    case 'integer': {
      const n = Number(raw);
      return Number.isFinite(n) ? n : raw;
    }
    default:
      return raw;
  }
};

export const conditionValue = (op: ConditionOp, text: string, type: ValueType): Json =>
  takesList(op) ? parseCell(text, { list: 'string' }) : parseCell(text, type);

const records = (x: unknown) =>
  (Array.isArray(x) ? x : []).flatMap((r) => (isRecord(r) ? [r] : []));

const columnsOf = (x: unknown): Column[] =>
  records(x).map((c) => ({
    name: String(c.name ?? ''),
    type: (c.type ?? 'string') as ValueType,
    ...(typeof c.label === 'string' ? { label: c.label } : {})
  }));

const recordOf = <T>(x: unknown) => (isRecord(x) ? (x as Record<string, T>) : {});

export const readDecision = (config: Json | undefined): DecisionConfig => {
  const c = recordOf<Json>(config);
  return {
    inputs: columnsOf(c.inputs),
    outputs: columnsOf(c.outputs),
    rules: records(c.rules).map((r) => ({
      label: String(r.label ?? ''),
      when: recordOf<Condition>(r.when),
      set: recordOf<Json>(r.set)
    })),
    otherwise: recordOf<Json>(c.otherwise)
  };
};

export const readLookup = (config: Json | undefined): LookupConfig => {
  const c = recordOf<Json>(config);
  return {
    type: (c.type ?? 'string') as ValueType,
    rows: records(c.rows).map((r) => ({
      key: String(r.key ?? ''),
      value: (r.value ?? null) as Json
    })),
    fallback: (c.fallback ?? null) as Json
  };
};

const renameKey = <T>(o: Record<string, T>, from: string, to: string) =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k === from ? to : k, v]));

const dropKey = <T>(o: Record<string, T>, key: string) =>
  Object.fromEntries(Object.entries(o).filter(([k]) => k !== key));

export const columnNameError = (
  c: DecisionConfig,
  side: 'inputs' | 'outputs',
  from: string,
  to: string
) => {
  const name = to.trim();
  if (!name) return 'Enter a name.';
  return name !== from && c[side].some((col) => col.name === name)
    ? `Another ${side === 'inputs' ? 'input' : 'output'} is already called ${name}.`
    : undefined;
};

export const renameColumn = (
  c: DecisionConfig,
  side: 'inputs' | 'outputs',
  from: string,
  raw: string
): DecisionConfig => {
  const to = raw.trim();
  return columnNameError(c, side, from, to) || to === from ? c : renamed(c, side, from, to);
};

const renamed = (
  c: DecisionConfig,
  side: 'inputs' | 'outputs',
  from: string,
  to: string
): DecisionConfig => ({
  ...c,
  [side]: c[side].map((col) => (col.name === from ? { ...col, name: to } : col)),
  rules: c.rules.map((r) =>
    side === 'inputs'
      ? { ...r, when: renameKey(r.when, from, to) }
      : { ...r, set: renameKey(r.set, from, to) }
  ),
  otherwise: side === 'outputs' ? renameKey(c.otherwise, from, to) : c.otherwise
});

export const removeColumn = (
  c: DecisionConfig,
  side: 'inputs' | 'outputs',
  name: string
): DecisionConfig => ({
  ...c,
  [side]: c[side].filter((col) => col.name !== name),
  rules: c.rules.map((r) =>
    side === 'inputs' ? { ...r, when: dropKey(r.when, name) } : { ...r, set: dropKey(r.set, name) }
  ),
  otherwise: side === 'outputs' ? dropKey(c.otherwise, name) : c.otherwise
});

export const freeName = (taken: readonly string[], base: string) => {
  let i = taken.length + 1;
  while (taken.includes(`${base}${i}`)) i++;
  return `${base}${i}`;
};

export const moveRule = (rules: readonly Rule[], index: number, by: -1 | 1): Rule[] => {
  const to = index + by;
  if (to < 0 || to >= rules.length) return [...rules];
  const next = [...rules];
  const [rule] = next.splice(index, 1);
  if (rule) next.splice(to, 0, rule);
  return next;
};

export const toJson = (c: DecisionConfig | LookupConfig) => c as unknown as Json;
