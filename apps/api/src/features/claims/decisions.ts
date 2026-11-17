import { type FieldSpec, isRecord, type Json } from '@ugula/graph';

export type DecisionValue = { label: string; value: string };

export type Decision = {
  task: string;
  outcome: string;
  values: DecisionValue[];
};

export type DecisionRow = {
  task_title: string | null;
  task_outcome: string | null;
  task_fields: unknown;
  task_defaults: unknown;
  task_values: unknown;
};

const MAX_VALUES = 8;

const labelOf = (name: string) => {
  const words = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const shownValue = (f: FieldSpec, value: Json): string | null => {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return String(value);
  if (typeof value !== 'string' || value.trim() === '') return null;
  return f.options?.find((o) => o.value === value)?.label ?? value;
};

const same = (a: Json | undefined, b: Json | undefined) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export const decisionValues = (
  fields: unknown,
  values: unknown,
  defaults: unknown
): DecisionValue[] => {
  const given = isRecord(values) ? values : {};
  const before = isRecord(defaults) ? defaults : {};
  return (Array.isArray(fields) ? (fields as FieldSpec[]) : [])
    .flatMap((f) => {
      const value = given[f.name];
      if (value === undefined || same(value, before[f.name])) return [];
      const shown = shownValue(f, value);
      return shown === null ? [] : [{ label: f.label ?? labelOf(f.name), value: shown }];
    })
    .slice(0, MAX_VALUES);
};

export const decisionOf = (row: DecisionRow): Decision | null =>
  !row.task_title || !row.task_outcome
    ? null
    : {
        task: row.task_title,
        outcome: row.task_outcome,
        values: decisionValues(row.task_fields, row.task_values, row.task_defaults)
      };

export const withDecision = <T extends DecisionRow>(row: T) => {
  const { task_title, task_outcome, task_fields, task_defaults, task_values, ...rest } = row;
  return { ...rest, decision: decisionOf(row) };
};
