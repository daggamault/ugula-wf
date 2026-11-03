import type { FieldSpec } from './schemas.ts';
import type { Json } from './types.ts';
import { checkValue } from './value-types.ts';

const isIsoDate = (x: string) => {
  const t = Date.parse(`${x}T00:00:00Z`);
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(x) && !Number.isNaN(t) && new Date(t).toISOString().startsWith(x)
  );
};

const isBlank = (value: Json) =>
  value === null ||
  (typeof value === 'string' && !value.trim()) ||
  (Array.isArray(value) && !value.length);

const rangeProblem = (field: FieldSpec, value: Json) => {
  if (typeof value !== 'number') return null;
  if (field.min !== undefined && value < field.min) return `must be at least ${field.min}`;
  if (field.max !== undefined && value > field.max) return `must be at most ${field.max}`;
  return null;
};

const valueProblem = (field: FieldSpec, value: Json) => {
  if (value === null) return null;
  if (field.options && !field.options.some((o) => o.value === String(value))) {
    return `must be one of ${field.options.map((o) => o.value).join(', ')}`;
  }
  if (field.format === 'date' && typeof value === 'string' && value && !isIsoDate(value)) {
    return 'must be a date (YYYY-MM-DD)';
  }
  return rangeProblem(field, value);
};

export const checkField = (field: FieldSpec, value: Json, outcome?: string): string | null =>
  checkValue(field.type, value) ??
  (outcome !== undefined && field.required?.includes(outcome) && isBlank(value)
    ? 'is required'
    : valueProblem(field, value));
